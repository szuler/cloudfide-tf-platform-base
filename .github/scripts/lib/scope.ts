// Pure logic: the scope guard. The agent may ONLY touch test files.
// Allowed: any *.tftest.hcl, and any file under a modules|stacks/<name>/tests/ dir
// (test helpers/fixtures). Everything else (infra .tf, workflow, scripts) is denied.
import { normalizePath } from "./changed.ts";

const TESTS_DIR_RE = /^(modules|stacks)\/[^/]+\/tests\//;

// `terraform init` writes a provider lock file; it is an expected build artifact of running
// the tests, not an agent-authored source change, so it is neither a violation nor committed.
const IGNORED_ARTIFACT_RE = /(^|\/)\.terraform\.lock\.hcl$/;

export function isAllowedTestPath(p: string): boolean {
  const f = normalizePath(p);
  if (!f) return true;
  return f.endsWith(".tftest.hcl") || TESTS_DIR_RE.test(f);
}

export function isIgnorableArtifact(p: string): boolean {
  return IGNORED_ARTIFACT_RE.test(normalizePath(p));
}

/** Return the subset of changed files the agent was NOT allowed to modify. */
export function scopeViolations(files: string[]): string[] {
  return files
    .map(normalizePath)
    .filter((f) => f.length > 0)
    .filter((f) => !isIgnorableArtifact(f))
    .filter((f) => !isAllowedTestPath(f))
    .sort();
}

/**
 * Parse `git status --porcelain` output into a list of changed paths. Covers tracked
 * modifications AND untracked files (git already excludes .gitignore'd paths), and resolves
 * the `old -> new` form used for renames/copies to the new path.
 */
export function parsePorcelain(output: string): string[] {
  const files: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const rest = line.slice(3); // strip the two-char XY status and its separating space
    const arrow = rest.indexOf(" -> ");
    files.push(arrow >= 0 ? rest.slice(arrow + 4) : rest);
  }
  return files;
}
