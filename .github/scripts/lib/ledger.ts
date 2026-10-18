// Pure logic: the PR ledger and the per-run comment.
//
// A PR gets two kinds of agent comment:
// - the ledger: ONE permanent comment, created on the first run and updated on every run, never
//   hidden. One row per run with what the agent did to the tests, so the reviewer never loses
//   "the agent added these tests" when a later run has nothing new to commit.
// - a run comment per run with the full report; older run comments are hidden as outdated.
//
// What changed in the tests is read from the agent's commits in git, not from the agent's
// report. The rows are also kept as state inside the ledger, so a force-push that drops an
// agent commit does not erase its row.
import { renderReportBody } from "./comment.ts";
import { headlineResults, score } from "./mutate.ts";
import { testPathChanges } from "./scope.ts";
import type {
  AgentCommit,
  AgentReport,
  CriticVerdict,
  Ledger,
  LedgerRow,
  PrComment,
  Report,
  TestFileChange,
} from "./types.ts";

export const LEDGER_MARKER = "<!-- tf-test-agent:ledger -->";
export const RUN_MARKER = "<!-- tf-test-agent:run -->";
/** The single sticky comment used before the ledger existed. */
export const LEGACY_MARKER = "<!-- tf-test-agent -->";
/** Replaced with the ledger comment's URL once the ledger has been posted. */
export const LEDGER_URL_PLACEHOLDER = "{{LEDGER_URL}}";
/** In the ledger: replaced with this run's report comment URL once that comment exists. */
export const RUN_COMMENT_URL_PLACEHOLDER = "{{RUN_COMMENT_URL}}";
/** GitHub's comment limit is 65,536 characters; stay well below it. */
export const MAX_COMMENT_CHARS = 60_000;
/** Runs whose details are shown in the ledger; older runs keep only their table row. */
const DETAIL_ROWS = 10;
/** The adopted pre-ledger comment is stored twice (shown + in state), so cap it. */
const LEGACY_MAX_CHARS = 20_000;

const STATE_OPEN = "<!-- tf-test-agent:state ";
const STATE_CLOSE = " -->";

// ── git facts ──────────────────────────────────────────────────────────────

/** Count `run "..."` blocks added/removed per file in a unified diff (`git show -U0`). */
export function countRunBlocks(diff: string): Map<string, { added: number; removed: number }> {
  const out = new Map<string, { added: number; removed: number }>();
  let file: string | undefined;
  let oldFile: string | undefined;
  let inHeader = false;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      inHeader = true;
      file = oldFile = undefined;
      continue;
    }
    if (inHeader) {
      const old = /^--- (?:a\/)?(.+)$/.exec(line);
      const neu = /^\+\+\+ (?:b\/)?(.+)$/.exec(line);
      if (old) oldFile = old[1] === "/dev/null" ? undefined : old[1];
      // A deleted file's new side is /dev/null; count its removed runs under the old path.
      if (neu) file = neu[1] === "/dev/null" ? oldFile : neu[1];
      if (line.startsWith("@@")) inHeader = false;
      continue;
    }
    if (!file) continue;
    const entry = out.get(file) ?? { added: 0, removed: 0 };
    if (/^\+\s*run\s+"/.test(line)) entry.added++;
    else if (/^-\s*run\s+"/.test(line)) entry.removed++;
    else continue;
    out.set(file, entry);
  }
  return out;
}

/** Test files a commit touched, from `git show --name-status` and `git show -U0`. */
export function testChanges(nameStatus: string, diff: string): TestFileChange[] {
  const runs = countRunBlocks(diff);
  return testPathChanges(nameStatus).map(({ status: code, path }) => {
    const status = code === "A" ? "created" : code === "D" ? "deleted" : "updated";
    const r = runs.get(path) ?? { added: 0, removed: 0 };
    return { path, status, runsAdded: r.added, runsRemoved: r.removed };
  });
}

/** Agent reasons are free text: keep each one to a single, bounded line in the commit. */
function oneLine(text: string, max = 200): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function commitMessage(report: AgentReport | null, pr: string, runUrl: string): string {
  const lines = [`test: agent-generated and reviewed tests for PR #${pr}`, "", `Run: ${runUrl}`];
  const decisions = report?.decisions ?? [];
  if (decisions.length) {
    lines.push("", "Decisions:");
    for (const d of decisions) lines.push(`- ${d.target}: ${d.action} — ${oneLine(d.reason)}`);
  }
  // `[skip ci]` keeps the agent's own commit from creating another run of the workflow.
  lines.push("", "[skip ci] The agent's own commit must not re-trigger the agent.", "");
  return lines.join("\n");
}

// ── state kept inside the ledger comment ──────────────────────────────────

export function encodeState(ledger: Ledger): string {
  // base64, so nothing in the rows can close the HTML comment early.
  return `${STATE_OPEN}${Buffer.from(JSON.stringify(ledger), "utf8").toString("base64")}${STATE_CLOSE}`;
}

/** Null when the body carries no readable state (the caller rebuilds rows from git). */
export function decodeState(body: string): Ledger | null {
  const start = body.indexOf(STATE_OPEN);
  if (start < 0) return null;
  const end = body.indexOf(STATE_CLOSE, start + STATE_OPEN.length);
  if (end < 0) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body.slice(start + STATE_OPEN.length, end), "base64").toString("utf8"));
    return parsed && Array.isArray(parsed.rows) ? (parsed as Ledger) : null;
  } catch {
    return null;
  }
}

// ── which existing comment is which ───────────────────────────────────────

export interface ExistingComments {
  ledger?: PrComment;
  /** The pre-ledger sticky comment, if there is no ledger yet. */
  legacy?: PrComment;
  runs: PrComment[];
}

/** `comments` must already be limited to the workflow bot's own, oldest first. */
export function classifyComments(comments: PrComment[]): ExistingComments {
  const ledger = comments.find((c) => c.body.includes(LEDGER_MARKER));
  const legacy = ledger ? undefined : comments.find((c) => c.body.includes(LEGACY_MARKER));
  return { ledger, legacy, runs: comments.filter((c) => c.body.includes(RUN_MARKER)) };
}

// ── building the ledger ───────────────────────────────────────────────────

export interface RunContext {
  runId: string;
  runUrl: string;
  headSha: string;
  agentCommit?: string;
  changes: TestFileChange[];
  changedBy?: LedgerRow["changedBy"];
}

export function rowFromReport(report: Report, ctx: RunContext): LedgerRow {
  const row: LedgerRow = {
    source: "run",
    runId: ctx.runId,
    runUrl: ctx.runUrl,
    headSha: ctx.headSha,
    changes: ctx.changes,
  };
  if (ctx.agentCommit) row.agentCommit = ctx.agentCommit;
  if (ctx.changedBy) row.changedBy = ctx.changedBy;
  if (report.notRun) {
    row.status = "not-run";
    return row;
  }

  let passed = 0;
  let total = 0;
  for (const r of report.results) {
    const s = r.test?.summary;
    if (s) {
      passed += s.passed;
      total += s.passed + s.failed + s.errored;
    }
  }
  const ok = report.results.every((r) => r.ok) && !report.problems?.length;
  row.status = ok ? "ok" : "failed";
  row.tests = { passed, total };

  if (report.mutations?.length) {
    // The headline score: what this PR's change / this PR's new suite is judged on.
    const { caught, scored } = score(report.mutations.flatMap(headlineResults));
    row.mutation = { caught, scored };
  }
  row.decisions = report.decisions.map(({ target, action, reason, reportedAction }) => ({
    target,
    action,
    reason: oneLine(reason, 500),
    ...(reportedAction ? { reportedAction } : {}),
  }));
  if (report.testReview !== undefined) {
    const review: Record<CriticVerdict, number> = { keep: 0, strengthen: 0, drop: 0 };
    for (const v of report.testReview) review[v.verdict]++;
    row.review = review;
  }
  row.findings = report.findings.length;
  if (report.problems?.length) row.problems = report.problems;
  return row;
}

/**
 * Previous rows, then a history row for every agent commit no row knows about (this covers
 * PRs that ran before the ledger existed), then the current run. A re-run of the same workflow
 * run replaces its own row. The pre-ledger comment body is kept on the first history row.
 */
export function updateLedger(
  previous: Ledger | null,
  current: LedgerRow,
  agentCommits: AgentCommit[],
  legacyBody?: string,
): Ledger {
  const rows = (previous?.rows ?? []).filter((r) => !current.runId || r.runId !== current.runId);
  const known = new Set([...rows, current].map((r) => r.agentCommit).filter(Boolean));
  const history: LedgerRow[] = agentCommits
    .filter((c) => !known.has(c.sha))
    .map((c) => ({ source: "history", headSha: c.parent, agentCommit: c.sha, changes: c.changes }));

  if (legacyBody && !previous) {
    let body = legacyBody.replace(LEGACY_MARKER, "").trim();
    if (body.length > LEGACY_MAX_CHARS) body = `${body.slice(0, LEGACY_MAX_CHARS)}\n\n_…truncated._`;
    if (history[0]) history[0].legacyBody = body;
    else history.push({ source: "history", changes: [], legacyBody: body });
  }
  return { rows: [...rows, ...history, current] };
}

// ── rendering ─────────────────────────────────────────────────────────────

const short = (sha?: string) => (sha ? `\`${sha.slice(0, 7)}\`` : "—");

const STATUS_ICON: Record<NonNullable<LedgerRow["status"]>, string> = { ok: "✅", failed: "❌", "not-run": "⚪" };

/**
 * The run number links to that run's report comment; the workflow log is the second link.
 * Run numbers are never written as plain `#N` anywhere in these comments: GitHub autolinks
 * `#N` to issue/PR N of the repo (backslash-escaping does not help inside <summary>).
 */
function runLabel(row: LedgerRow, n: number, commentUrl?: string): string {
  if (row.source === "history") return `${n} _(earlier run)_`;
  if (commentUrl) return row.runUrl ? `[${n}](${commentUrl}) · [log](${row.runUrl})` : `[${n}](${commentUrl})`;
  return row.runUrl ? `[${n}](${row.runUrl})` : `${n}`;
}

/**
 * Report comment URL per workflow run URL. Each run comment links its workflow run in its
 * header, so older rows are matched to their comments without storing anything new; a deleted
 * comment simply falls back to the log link.
 */
export function runCommentUrls(runComments: PrComment[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const c of runComments) {
    const m = /\[workflow run\]\(([^)\s]+)\)/.exec(c.body);
    if (m) out.set(m[1]!, c.html_url);
  }
  return out;
}

export function describeChange(c: TestFileChange): string {
  const runs: string[] = [];
  if (c.runsAdded) runs.push(`+${c.runsAdded} run${c.runsAdded === 1 ? "" : "s"}`);
  if (c.runsRemoved) runs.push(`−${c.runsRemoved} run${c.runsRemoved === 1 ? "" : "s"}`);
  const detail = runs.length ? runs.join(", ") : c.status === "updated" ? "assertions changed" : "";
  return `\`${c.path}\` ${c.status}${detail ? ` (${detail})` : ""}`;
}

/** " · by author", " · by critic", " · by author + critic", or "" when not recorded. */
export function changedByLabel(row: LedgerRow, path: string): string {
  if (!row.changedBy) return "";
  const who = (["author", "critic"] as const).filter((pass) => row.changedBy![pass].includes(path));
  return who.length ? ` · by ${who.join(" + ")}` : "";
}

function describeRowChanges(row: LedgerRow, separator: string): string {
  return row.changes.map((c) => `${describeChange(c)}${changedByLabel(row, c.path)}`).join(separator);
}

function changesCell(row: LedgerRow): string {
  if (row.changes.length) return describeRowChanges(row, "<br>");
  if (row.status === "not-run") return "agent did not run";
  if (row.source === "history") return "—";
  return row.status === "failed" ? "no test changes committed" : "no test changes";
}

function commitCell(row: LedgerRow, onBranch: Set<string>): string {
  if (!row.agentCommit) return short(row.headSha);
  const gone = onBranch.has(row.agentCommit) ? "" : " _(no longer on the branch)_";
  return `${short(row.headSha)} → ${short(row.agentCommit)}${gone}`;
}

function testsCell(row: LedgerRow): string {
  if (!row.status) return "—";
  if (!row.tests) return STATUS_ICON[row.status];
  return `${STATUS_ICON[row.status]} ${row.tests.passed}/${row.tests.total}`;
}

function rowDetails(row: LedgerRow, n: number, commentUrl?: string): string | null {
  if (row.legacyBody) {
    return `<details><summary>Run ${n} — original report (posted before this summary existed)</summary>\n\n${row.legacyBody}\n\n</details>`;
  }
  if (!row.decisions?.length && !row.problems?.length) return null;
  const lines: string[] = [];
  for (const p of row.problems ?? []) lines.push(`- ❌ ${p}`);
  for (const d of row.decisions ?? []) {
    const action = d.reportedAction ? `${d.action} _(agent reported “${d.reportedAction}”; git shows no test changes)_` : d.action;
    lines.push(`- **${d.target}** — ${action}: ${d.reason}`);
  }
  const extra: string[] = [];
  if (row.review) extra.push(`critic: ${row.review.keep} keep, ${row.review.strengthen} strengthen, ${row.review.drop} drop`);
  if (row.findings !== undefined) extra.push(`${row.findings} finding(s)`);
  if (extra.length) lines.push(`- _${extra.join(" · ")}_`);
  if (commentUrl) lines.push(`- [Full report of run ${n}](${commentUrl})`);
  return `<details><summary>Run ${n} — decisions</summary>\n\n${lines.join("\n")}\n\n</details>`;
}

/**
 * `onBranch`: agent commits still reachable from the PR head. `commentUrls`: report comment
 * URL per workflow run URL (see `runCommentUrls`); the current run's comment does not exist yet,
 * so the caller maps it to `RUN_COMMENT_URL_PLACEHOLDER`.
 */
export function renderLedger(ledger: Ledger, onBranch: Set<string>, commentUrls = new Map<string, string>()): string {
  const commentFor = (row: LedgerRow) => (row.runUrl ? commentUrls.get(row.runUrl) : undefined);
  const head = [
    LEDGER_MARKER,
    "## 🧪 Terraform Test Agent — summary for this PR",
    "",
    "_Kept up to date on every run and never hidden: one row per agent run. Each run's full report " +
      "is in its own comment below (older ones are collapsed as outdated) and in the run's artifacts._",
    "",
    "| Run | Commit | Tests | What the agent did with the tests | Mutations |",
    "| --- | --- | --- | --- | --- |",
  ];
  ledger.rows.forEach((row, i) => {
    const mutation = row.mutation ? `${row.mutation.caught}/${row.mutation.scored}` : "—";
    head.push(
      `| ${runLabel(row, i + 1, commentFor(row))} | ${commitCell(row, onBranch)} | ${testsCell(row)} | ${changesCell(row)} | ${mutation} |`,
    );
  });

  const details = ledger.rows
    .map((row, i) => ({ i, text: rowDetails(row, i + 1, commentFor(row)) }))
    .filter((d): d is { i: number; text: string } => d.text !== null)
    .slice(-DETAIL_ROWS);
  // The state is a copy, so slimming it below never changes the caller's ledger.
  const stateRows: LedgerRow[] = ledger.rows.map((r) => ({ ...r }));
  const assemble = () =>
    [...head, "", ...details.map((d) => d.text), "", encodeState({ rows: stateRows })].join("\n");

  // Too long: oldest run first, drop its visible details and its bulky state (old report body,
  // decision reasons). The table rows always stay.
  let body = assemble();
  for (let i = 0; i < stateRows.length && body.length > MAX_COMMENT_CHARS; i++) {
    const shown = details.findIndex((d) => d.i === i);
    if (shown >= 0) details.splice(shown, 1);
    delete stateRows[i]!.legacyBody;
    delete stateRows[i]!.decisions;
    body = assemble();
  }
  return body;
}

/** The per-run comment: a header tying it to its commit/run/ledger, then the full report. */
export function renderRunComment(report: Report, row: LedgerRow, n: number): string {
  const testsLine = row.changes.length
    ? `**Test changes in this run** (commit ${short(row.agentCommit)}): ${describeRowChanges(row, "; ")}`
    : `**No test changes in this run.** Tests the agent added earlier in this PR are listed in the [summary](${LEDGER_URL_PLACEHOLDER}).`;
  const header = [
    RUN_MARKER,
    `## 🧪 Terraform Test Agent — run ${n}`,
    "",
    `Commit ${short(row.headSha)} · ${row.runUrl ? `[workflow run](${row.runUrl})` : "workflow run"} · [PR summary](${LEDGER_URL_PLACEHOLDER})`,
    "",
    testsLine,
    "",
  ];
  const body = [...header, renderReportBody(report)].join("\n");
  return body.length > MAX_COMMENT_CHARS
    ? `${body.slice(0, MAX_COMMENT_CHARS)}\n\n_…truncated; the full report is in the run's artifacts._`
    : body;
}
