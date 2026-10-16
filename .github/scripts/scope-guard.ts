// CLI: fail if any changed file is outside the agent's allowed scope (test files only).
// With file args: checks those paths. Without: diffs the working tree against BASE_REF.
// Usage: node scripts/scope-guard.ts [file ...]   |   BASE_REF=<ref> node scripts/scope-guard.ts
import { run } from "./lib/exec.ts";
import { scopeViolations } from "./lib/scope.ts";

function getChangedFiles(baseRef: string): string[] {
  const res = run("git", ["diff", "--name-only", baseRef], process.cwd());
  if (res.code !== 0) {
    process.stderr.write(res.stderr || "git diff failed\n");
    process.exit(2);
  }
  return res.stdout.split(/\r?\n/).filter((l) => l.trim().length > 0);
}

function main(): void {
  const argFiles = process.argv.slice(2);
  const files = argFiles.length > 0 ? argFiles : getChangedFiles(process.env.BASE_REF ?? "HEAD");

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
