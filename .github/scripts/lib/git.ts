// Thin git wrappers shared by the CLIs. Side-effecting (spawns git), so kept out of the pure logic.
import { run } from "./exec.ts";

/** The merge base of two refs, falling back to `baseRef` itself. */
export function mergeBase(baseRef: string, headRef: string): string {
  const mb = run("git", ["merge-base", baseRef, headRef], process.cwd());
  return mb.code === 0 ? mb.stdout.trim() : baseRef;
}

/** Does `path` exist at `commit`? */
export function existsAt(commit: string, path: string): boolean {
  return run("git", ["cat-file", "-e", `${commit}:${path}`], process.cwd()).code === 0;
}
