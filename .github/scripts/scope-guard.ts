// CLI: fail if the agent changed anything outside its allowed scope (test files only).
// With file args: checks those paths. Without: inspects ALL uncommitted changes via
// `git status --porcelain`, which includes untracked files and excludes .gitignore'd paths
// (so the git-ignored agent report and .terraform/ never count). The provider lock file is
// treated as an expected init artifact, not a violation.
// Usage: node scripts/scope-guard.ts [file ...]   |   node scripts/scope-guard.ts
import { run } from "./lib/exec.ts";
import { parsePorcelain, scopeViolations } from "./lib/scope.ts";

function changedFiles(): string[] {
  const res = run("git", ["status", "--porcelain"], process.cwd());
  if (res.code !== 0) {
    process.stderr.write(res.stderr || "git status failed\n");
    process.exit(2);
  }
  return parsePorcelain(res.stdout);
}

function main(): void {
  const argFiles = process.argv.slice(2);
  const files = argFiles.length > 0 ? argFiles : changedFiles();

  const violations = scopeViolations(files);
  if (violations.length > 0) {
    process.stderr.write(
      "Scope guard FAILED: the agent may only modify test files " +
        "(**/*.tftest.hcl, modules|stacks/<name>/tests/**).\n" +
        "Disallowed changes:\n" +
        violations.map((v) => `  - ${v}`).join("\n") +
        "\n",
    );
    process.exit(1);
  }
  process.stdout.write("Scope guard OK: only test files changed.\n");
}

main();
