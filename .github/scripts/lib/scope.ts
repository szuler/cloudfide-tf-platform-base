// Pure logic: the scope guard. The agent may ONLY touch test files.
// Allowed: any *.tftest.hcl, and any file under a modules|stacks/<name>/tests/ dir
// (test helpers/fixtures). Everything else (infra .tf, workflow, scripts) is denied.
import { normalizePath } from "./changed.ts";

const TESTS_DIR_RE = /^(modules|stacks)\/[^/]+\/tests\//;

export function isAllowedTestPath(p: string): boolean {
  const f = normalizePath(p);
  if (!f) return true;
  return f.endsWith(".tftest.hcl") || TESTS_DIR_RE.test(f);
}

/** Return the subset of changed files the agent was NOT allowed to modify. */
export function scopeViolations(files: string[]): string[] {
  return files
    .map(normalizePath)
    .filter((f) => f.length > 0)
    .filter((f) => !isAllowedTestPath(f))
    .sort();
}
