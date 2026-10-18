// CLI: snapshot the test files between the two agent passes, so the workflow can tell the
// critic whether the author changed tests in this run, undo critic edits when it was not
// allowed to make any, and attribute each test change to the author or the critic.
// Snapshots go through a scratch git index, never the real index or working tree.
// Usage:
//   node scripts/test-snapshot.ts tree             print a tree id: HEAD + every current change under modules/ and stacks/
//   node scripts/test-snapshot.ts list <a> <b>     print each test file that differs between trees a and b
//   node scripts/test-snapshot.ts restore <a> <b>  put test files that differ back to how they are in tree a
//                                                  (b = the current state); print each restored path
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./lib/exec.ts";
import { testPathChanges } from "./lib/scope.ts";

const ROOTS = ["modules", "stacks"];

function git(args: string[], env?: NodeJS.ProcessEnv): string {
  const r = run("git", args, process.cwd(), env);
  if (r.code !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr.trim()}`);
  return r.stdout.trim();
}

function snapshotTree(): string {
  const dir = mkdtempSync(join(tmpdir(), "test-snapshot-"));
  try {
    const env = { GIT_INDEX_FILE: join(dir, "index") };
    git(["read-tree", "HEAD"], env);
    const roots = ROOTS.filter((r) => existsSync(r));
    if (roots.length) git(["add", "-A", "--", ...roots], env);
    return git(["write-tree"], env);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function testDiff(a: string, b: string) {
  // --no-renames: a rename is a delete + an add, which `restore` undoes correctly.
  const roots = ROOTS.filter((r) => existsSync(r));
  return testPathChanges(git(["diff", "--name-status", "--no-renames", a, b, "--", ...roots]));
}

function main(): void {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === "tree") {
    process.stdout.write(`${snapshotTree()}\n`);
  } else if (cmd === "list" && a && b) {
    for (const c of testDiff(a, b)) process.stdout.write(`${c.path}\n`);
  } else if (cmd === "restore" && a && b) {
    for (const c of testDiff(a, b)) {
      // Added after `a`: remove it. Changed or deleted: bring back a's version (worktree only).
      if (c.status === "A") rmSync(c.path, { force: true });
      else git(["restore", `--source=${a}`, "--worktree", "--", c.path]);
      process.stdout.write(`${c.path}\n`);
    }
  } else {
    process.stderr.write("usage: test-snapshot tree | list <a> <b> | restore <a> <b>\n");
    process.exit(2);
  }
}

main();
