// CLI: print the modules/stacks changed between two git refs, as JSON.
// Usage: node scripts/detect-changed-modules.ts [baseRef] [headRef]
//   or:  BASE_REF=origin/main HEAD_REF=HEAD node scripts/detect-changed-modules.ts
import { run } from "./lib/exec.ts";
import { detectChangedTargets, markNewTargets } from "./lib/changed.ts";

/** Did `dir` exist at the merge base of the two refs? (falls back to baseRef itself) */
function existsAtBase(baseRef: string, headRef: string): (dir: string) => boolean {
  const mb = run("git", ["merge-base", baseRef, headRef], process.cwd());
  const base = mb.code === 0 ? mb.stdout.trim() : baseRef;
  return (dir) => run("git", ["cat-file", "-e", `${base}:${dir}`], process.cwd()).code === 0;
}

function getChangedFiles(baseRef: string, headRef: string): string[] {
  // Prefer the three-dot range (merge-base diff); fall back to a plain diff.
  let res = run("git", ["diff", "--name-only", `${baseRef}...${headRef}`], process.cwd());
  if (res.code !== 0) {
    res = run("git", ["diff", "--name-only", baseRef], process.cwd());
  }
  if (res.code !== 0) {
    process.stderr.write(res.stderr || "git diff failed\n");
    process.exit(1);
  }
  return res.stdout.split(/\r?\n/).filter((l) => l.trim().length > 0);
}

function main(): void {
  const baseRef = process.env.BASE_REF ?? process.argv[2] ?? "origin/main";
  const headRef = process.env.HEAD_REF ?? process.argv[3] ?? "HEAD";
  const result = markNewTargets(
    detectChangedTargets(getChangedFiles(baseRef, headRef)),
    existsAtBase(baseRef, headRef),
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main();
