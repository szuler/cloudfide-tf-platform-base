// CLI: mutation-test module test suites. For each applicable mutation, copy the module to a
// temp dir, apply the mutation, run `terraform test`, and expect it to FAIL.
// A mutation the tests still PASS under is a coverage gap ("survived"). A mutant that does not
// even init or plan is "invalid" and counts for nothing.
// Usage: TERRAFORM_BIN=... node .github/scripts/mutation-check.ts [--base <ref>] [--json <out.json>] <dir>...
// With --base (CI passes the PR's base commit), each module gets a scope from git facts: a suite
// created in the PR is judged as a whole; otherwise the headline is mutants on changed lines, and
// each mutation prefers an occurrence on a changed line. Without it, every mutant counts.
// Exit: 0 = no survivors, 1 = at least one survived, 2 = usage error, 3 = nothing was checked.
// Locally the exit code is the answer; in CI the JSON feeds the PR comment (informational).
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { run, terraformBin } from "./lib/exec.ts";
import { existsAt, mergeBase } from "./lib/git.ts";
import { parseTestJson } from "./lib/tf-report.ts";
import {
  applyMutationPreferring,
  classifyMutationRun,
  DEFAULT_MUTATIONS,
  headlineResults,
  mutationTargetsFile,
  parseChangedLines,
  restResults,
  score,
  type Mutation,
} from "./lib/mutate.ts";
import type { MutationOutcome, MutationReport, MutationScope } from "./lib/types.ts";

// On Windows a provider binary can stay locked briefly after Terraform exits (EPERM/EBUSY);
// Node retries those errors when maxRetries is set.
const RM_TREE = { recursive: true, force: true, maxRetries: 10, retryDelay: 200 } as const;

const SCOPE_LABEL: Record<MutationScope, string> = {
  "suite-created": "suite created in this PR",
  change: "changed code",
  module: "module",
};

function tfSourceFiles(dir: string): string[] {
  return readdirSync(dir).filter((f) => f.endsWith(".tf"));
}

interface PlannedMutant {
  mutation: Mutation;
  file: string;
  /** The mutated file content. */
  content: string;
  line?: number;
  inChange: boolean;
}

/**
 * One mutant per mutation: the first occurrence on a changed line in any file, otherwise the
 * first occurrence anywhere. `changed` maps a module file name to its changed line numbers.
 */
function planMutants(moduleDir: string, changed: Map<string, Set<number>>): PlannedMutant[] {
  const out: PlannedMutant[] = [];
  for (const mutation of DEFAULT_MUTATIONS) {
    let fallback: PlannedMutant | undefined;
    let chosen: PlannedMutant | undefined;
    for (const file of tfSourceFiles(moduleDir)) {
      if (!mutationTargetsFile(mutation, file)) continue;
      const placed = applyMutationPreferring(readFileSync(join(moduleDir, file), "utf8"), mutation, changed.get(file));
      if (!placed.applied) continue;
      const mutant = { mutation, file, content: placed.result, line: placed.line, inChange: placed.inChange };
      if (placed.inChange) {
        chosen = mutant;
        break;
      }
      fallback ??= mutant;
    }
    const pick = chosen ?? fallback;
    if (pick) out.push(pick);
  }
  return out;
}

/** The module's path relative to the repo root (git's form), or null if it is outside it. */
function repoPath(moduleDir: string): string | null {
  const rel = relative(process.cwd(), resolve(moduleDir));
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
  return rel.split(sep).join("/");
}

/** Scope and changed lines (by module file name) for a module, from git. */
function gitScope(moduleDir: string, base: string | undefined): { scope: MutationScope; changed: Map<string, Set<number>> } {
  const rel = repoPath(moduleDir);
  if (!base || !rel) return { scope: "module", changed: new Map() };
  const suiteExisted = existsAt(mergeBase(base, "HEAD"), `${rel}/tests`);
  const diff = run("git", ["diff", "-U0", `${base}...HEAD`, "--", rel], process.cwd());
  const changed = new Map<string, Set<number>>();
  for (const [path, lines] of parseChangedLines(diff.code === 0 ? diff.stdout : "")) {
    if (path.startsWith(`${rel}/`)) changed.set(path.slice(rel.length + 1), lines);
  }
  return { scope: suiteExisted ? "change" : "suite-created", changed };
}

function copyTree(from: string, to: string): void {
  cpSync(from, to, { recursive: true, filter: (src) => basename(src) !== ".terraform" });
}

/**
 * Copy the module into a fresh dir under the OS temp dir and return the copy's path. Not inside
 * the repo: an editor's terraform-ls would pick the copy up as a module and lock its provider.
 * For a dir inside the repo, mirror `modules/` and `stacks/` so relative module sources
 * (`../../modules/x`) still resolve from the copy.
 */
function stageCopy(root: string, moduleDir: string): string {
  const rel = relative(process.cwd(), resolve(moduleDir));
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    const dir = join(root, basename(moduleDir));
    copyTree(moduleDir, dir);
    return dir;
  }
  for (const top of ["modules", "stacks"]) if (existsSync(top)) copyTree(top, join(root, top));
  const dir = join(root, rel);
  if (!existsSync(dir)) copyTree(moduleDir, dir);
  return dir;
}

function runMutation(moduleDir: string, mutant: PlannedMutant): MutationOutcome {
  const tf = terraformBin();
  const root = mkdtempSync(join(tmpdir(), `mut-${mutant.mutation.name}-`));
  try {
    const tmp = stageCopy(root, moduleDir);
    rmSync(join(tmp, ".terraform.lock.hcl"), { force: true });
    writeFileSync(join(tmp, mutant.file), mutant.content);

    const init = run(tf, ["init", "-backend=false", "-no-color", "-input=false"], tmp);
    if (init.code !== 0) return "invalid";
    const test = run(tf, ["test", "-json"], tmp);
    return classifyMutationRun(true, parseTestJson(test.stdout));
  } finally {
    removeBestEffort(root);
  }
}

/** A crashed Terraform can leave its provider running, which locks the copy on Windows. */
function removeBestEffort(dir: string): void {
  try {
    rmSync(dir, RM_TREE);
  } catch (e) {
    process.stderr.write(
      `warning: could not remove ${dir} (${(e as Error).message}); ` +
        "a crashed Terraform may have left its provider process running.\n",
    );
  }
}

function checkModule(moduleDir: string, base: string | undefined): MutationReport {
  if (!existsSync(join(moduleDir, "tests"))) {
    return { dir: moduleDir, results: [], note: "no tests/ directory — nothing to mutation-check" };
  }
  const { scope, changed } = gitScope(moduleDir, base);
  const mutants = planMutants(moduleDir, changed);
  if (mutants.length === 0) {
    return { dir: moduleDir, scope, results: [], note: "no applicable mutation — not checked" };
  }
  const report: MutationReport = { dir: moduleDir, scope, results: [] };
  for (const mutant of mutants) {
    const outcome = runMutation(moduleDir, mutant);
    const { mutation, file, line, inChange } = mutant;
    report.results.push({ name: mutation.name, file, line, inChange, outcome, hint: mutation.hint });
    const where = `${moduleDir}/${file}:${line}${inChange ? ", changed line" : ""}`;
    process.stderr.write(`  ${outcome.padEnd(8)}  ${mutation.name} (${where})\n`);
  }
  return report;
}

function main(): void {
  const args = process.argv.slice(2);
  let jsonOut: string | undefined;
  let base: string | undefined;
  const dirs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--json") jsonOut = args[++i];
    else if (args[i] === "--base") base = args[++i];
    else dirs.push(args[i]!);
  }
  if (dirs.length === 0 || (args.includes("--json") && !jsonOut) || (args.includes("--base") && !base)) {
    process.stderr.write("usage: mutation-check [--base <ref>] [--json <out.json>] <module-dir>...\n");
    process.exit(2);
  }

  // Share one provider cache across all inits so we download the provider only once.
  const cache = mkdtempSync(join(tmpdir(), "tf-plugin-cache-"));
  process.env.TF_PLUGIN_CACHE_DIR = cache;

  const reports: MutationReport[] = [];
  try {
    for (const dir of dirs) reports.push(checkModule(dir, base));
  } finally {
    removeBestEffort(cache);
  }

  if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify(reports, null, 2)}\n`);

  let checked = 0;
  let survivedTotal = 0;
  for (const r of reports) {
    if (r.note) {
      process.stdout.write(`${r.dir}: ${r.note}\n`);
      continue;
    }
    const all = score(r.results);
    checked += all.scored;
    survivedTotal += all.scored - all.caught;
    const head = score(headlineResults(r));
    process.stdout.write(`${r.dir} — ${SCOPE_LABEL[r.scope ?? "module"]}: ${head.caught}/${head.scored} caught, ${head.invalid} invalid mutant(s)\n`);
    const rest = restResults(r);
    if (rest.length) {
      const s = score(rest);
      process.stdout.write(`  rest of the module (pre-existing tests): ${s.caught}/${s.scored} caught\n`);
    }
    for (const s of r.results.filter((x) => x.outcome === "survived")) {
      process.stdout.write(`  survived: ${s.name} (${s.file}:${s.line}) — ${s.hint}\n`);
    }
  }

  if (survivedTotal > 0) process.exit(1);
  if (checked === 0) process.exit(3);
  process.exit(0);
}

main();
