// Pure logic: map a list of changed file paths to the modules/stacks they touch.
import type { ChangedTarget, DetectResult, TargetKind } from "./types.ts";

const MODULE_RE = /^modules\/([^/]+)\//;
const STACK_RE = /^stacks\/([^/]+)\//;
const TF_FILE_RE = /\.(tf|tfvars|tftest\.hcl)$/;

/** Normalise Windows backslashes and surrounding whitespace to forward-slash form. */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").trim();
}

/**
 * Group changed files by the module/stack directory they belong to.
 * Non-Terraform files, and Terraform files outside modules/ and stacks/, are
 * returned under `ignored` rather than silently dropped.
 */
export function detectChangedTargets(files: string[]): DetectResult {
  const byDir = new Map<string, ChangedTarget>();
  const ignored: string[] = [];

  for (const raw of files) {
    const f = normalizePath(raw);
    if (!f) continue;

    if (!TF_FILE_RE.test(f)) {
      ignored.push(f);
      continue;
    }

    const moduleName = MODULE_RE.exec(f)?.[1];
    const stackName = STACK_RE.exec(f)?.[1];

    let kind: TargetKind;
    let name: string;
    if (moduleName) {
      kind = "module";
      name = moduleName;
    } else if (stackName) {
      kind = "stack";
      name = stackName;
    } else {
      ignored.push(f);
      continue;
    }

    const dir = `${kind === "module" ? "modules" : "stacks"}/${name}`;
    const existing = byDir.get(dir);
    if (existing) {
      existing.files.push(f);
    } else {
      byDir.set(dir, { kind, name, dir, files: [f] });
    }
  }

  const targets = [...byDir.values()].sort((a, b) => a.dir.localeCompare(b.dir));
  for (const t of targets) t.files.sort();
  return { targets, ignored: ignored.sort() };
}

/**
 * Mark each target new or existing. `existsAtBase` answers "did this dir exist at the PR's
 * base commit?" — injected so this stays pure (the CLI asks git).
 */
export function markNewTargets(result: DetectResult, existsAtBase: (dir: string) => boolean): DetectResult {
  return {
    ...result,
    targets: result.targets.map((t) => ({ ...t, isNew: !existsAtBase(t.dir) })),
  };
}
