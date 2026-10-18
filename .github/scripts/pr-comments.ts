// CLI: render the PR ledger and this run's comment, and say which existing comments to
// update or hide. Git facts (the agent's commits and the test files they touched) are read
// here; everything else is pure logic in lib/ledger.ts.
// Usage: node scripts/pr-comments.ts --report <report.json> --comments <comments.json> \
//          --base <sha> --head <sha> --run-id <id> --run-url <url> [--agent-commit <sha>] \
//          [--author-tree <tree>] --out-dir <dir>
// --author-tree (the snapshot after the author pass) splits the agent commit's test changes
// into the author's and the critic's.
// Writes <out-dir>/ledger.md, <out-dir>/run-comment.md and <out-dir>/comment-plan.json.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./lib/exec.ts";
import {
  classifyComments,
  decodeState,
  renderLedger,
  renderRunComment,
  rowFromReport,
  RUN_COMMENT_URL_PLACEHOLDER,
  runCommentUrls,
  testChanges,
  updateLedger,
} from "./lib/ledger.ts";
import { testPathChanges } from "./lib/scope.ts";
import type { AgentCommit, PrComment, Report } from "./lib/types.ts";

/** The identity the workflow commits agent tests under (see the commit step). */
const AGENT_EMAIL = "tf-test-agent@users.noreply.github.com";

function git(args: string[]): string {
  const r = run("git", args, process.cwd());
  if (r.code !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr.trim()}`);
  return r.stdout;
}

function commitChanges(sha: string) {
  return testChanges(
    git(["show", "--format=", "--name-status", sha]),
    git(["show", "--format=", "-U0", sha, "--", "*.tftest.hcl"]),
  );
}

/** Before the author → after the author is the author's; after the author → committed is the critic's. */
function changedBy(agentCommit: string, authorTree: string) {
  const paths = (from: string, to: string) =>
    testPathChanges(git(["diff", "--name-status", "--no-renames", from, to])).map((c) => c.path);
  return { author: paths(`${agentCommit}^`, authorTree), critic: paths(authorTree, agentCommit) };
}

/** Agent commits on the PR branch, oldest first. */
function agentCommits(base: string): AgentCommit[] {
  const log = git(["log", "--reverse", `--author=${AGENT_EMAIL}`, "--format=%H %P", `${base}..HEAD`]);
  return log
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [sha, parent] = line.split(" ");
      return { sha: sha!, parent, changes: commitChanges(sha!) };
    });
}

function args(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (key?.startsWith("--")) out[key.slice(2)] = argv[i + 1] ?? "";
  }
  return out;
}

function main(): void {
  const a = args(process.argv.slice(2));
  for (const k of ["report", "comments", "base", "head", "run-id", "run-url", "out-dir"]) {
    if (!a[k]) {
      process.stderr.write(`missing --${k}\n`);
      process.exit(2);
    }
  }

  const report = JSON.parse(readFileSync(a.report!, "utf8")) as Report;
  const comments = JSON.parse(readFileSync(a.comments!, "utf8")) as PrComment[];
  const existing = classifyComments(comments);
  const commits = agentCommits(a.base!);
  const agentCommit = a["agent-commit"] || undefined;

  const authorTree = a["author-tree"] || undefined;
  const current = rowFromReport(report, {
    runId: a["run-id"]!,
    runUrl: a["run-url"]!,
    headSha: a.head!,
    agentCommit,
    changes: agentCommit ? commitChanges(agentCommit) : [],
    changedBy: agentCommit && authorTree ? changedBy(agentCommit, authorTree) : undefined,
  });
  const previous = existing.ledger ? decodeState(existing.ledger.body) : null;
  if (existing.ledger && !previous) {
    process.stderr.write("::warning::Ledger state unreadable; rebuilding its rows from git history.\n");
  }
  const ledger = updateLedger(previous, current, commits, existing.legacy?.body);
  const onBranch = new Set(commits.map((c) => c.sha));

  mkdirSync(a["out-dir"]!, { recursive: true });
  // Earlier rows link to their report comments; this run's comment is posted after the ledger,
  // so its link is a placeholder the publish step fills in.
  const commentUrls = runCommentUrls(existing.runs);
  commentUrls.set(current.runUrl!, RUN_COMMENT_URL_PLACEHOLDER);
  writeFileSync(join(a["out-dir"]!, "ledger.md"), renderLedger(ledger, onBranch, commentUrls));
  writeFileSync(join(a["out-dir"]!, "run-comment.md"), renderRunComment(report, current, ledger.rows.length));
  // The legacy comment is adopted as the ledger (it is the PR's first agent comment, so it keeps
  // its place at the top); every earlier run comment gets hidden as outdated.
  const plan = {
    ledgerCommentId: (existing.ledger ?? existing.legacy)?.id ?? null,
    minimize: existing.runs.map((c) => c.node_id),
  };
  writeFileSync(join(a["out-dir"]!, "comment-plan.json"), `${JSON.stringify(plan, null, 2)}\n`);
}

main();
