// CLI: mutation-test module test suites. For each applicable mutation, copy the module to a
// temp dir, apply the mutation, run `terraform test`, and expect it to FAIL.
// A mutation the tests still PASS under is a coverage gap ("survived"). A mutant that does not
// even init or plan is "invalid" and counts for nothing.
// Usage: TERRAFORM_BIN=... node .github/scripts/mutation-check.ts [--json <out.json>] <dir>...
// Exit: 0 = no survivors, 1 = at least one survived, 2 = usage error, 3 = nothing was checked.
// Locally the exit code is the answer; in CI the JSON feeds the PR comment (informational).
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { run, terraformBin } from "./lib/exec.ts";
import { parseTestJson } from "./lib/tf-report.ts";
import {
  applyMutation,
  classifyMutationRun,
  DEFAULT_MUTATIONS,
  mutationTargetsFile,
  type Mutation,
} from "./lib/mutate.ts";
import type { MutationOutcome, MutationReport } from "./lib/types.ts";

// On Windows a provider binary can stay locked briefly after Terraform exits (EPERM/EBUSY);
// Node retries those errors when maxRetries is set.
const RM_TREE = { recursive: true, force: true, maxRetries: 10, retryDelay: 200 } as const;

function tfSourceFiles(dir: string): string[] {
  return readdirSync(dir).filter((f) => f.endsWith(".tf"));
}

/** Find, for each mutation, a source file it applies to (first match wins). */
function applicableMutations(moduleDir: string): Array<{ mutation: Mutation; file: string }> {
  const files = tfSourceFiles(moduleDir);
  const out: Array<{ mutation: Mutation; file: string }> = [];
  for (const mutation of DEFAULT_MUTATIONS) {
    for (const file of files) {
      if (!mutationTargetsFile(mutation, file)) continue;
      const content = readFileSync(join(moduleDir, file), "utf8");
      if (applyMutation(content, mutation).applied) {
        out.push({ mutation, file });
        break;
      }
    }
  }
  return out;
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

function runMutation(moduleDir: string, mutation: Mutation, file: string): MutationOutcome {
  const tf = terraformBin();
  const root = mkdtempSync(join(tmpdir(), `mut-${mutation.name}-`));
  try {
    const tmp = stageCopy(root, moduleDir);
    rmSync(join(tmp, ".terraform.lock.hcl"), { force: true });

    const target = join(tmp, file);
    writeFileSync(target, applyMutation(readFileSync(target, "utf8"), mutation).result);

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

function checkModule(moduleDir: string): MutationReport {
  if (!existsSync(join(moduleDir, "tests"))) {
    return { dir: moduleDir, results: [], note: "no tests/ directory — nothing to mutation-check" };
  }
  const applicable = applicableMutations(moduleDir);
  if (applicable.length === 0) {
    return { dir: moduleDir, results: [], note: "no applicable mutation — not checked" };
  }
  const report: MutationReport = { dir: moduleDir, results: [] };
  for (const { mutation, file } of applicable) {
    const outcome = runMutation(moduleDir, mutation, file);
    report.results.push({ name: mutation.name, file, outcome, hint: mutation.hint });
    process.stderr.write(`  ${outcome.padEnd(8)}  ${mutation.name} (${moduleDir}/${file})\n`);
  }
  return report;
}

function main(): void {
  const args = process.argv.slice(2);
  let jsonOut: string | undefined;
  const dirs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--json") jsonOut = args[++i];
    else dirs.push(args[i]!);
  }
  if (dirs.length === 0 || (args.includes("--json") && !jsonOut)) {
    process.stderr.write("usage: mutation-check [--json <out.json>] <module-dir>...\n");
    process.exit(2);
  }

  // Share one provider cache across all inits so we download the provider only once.
  const cache = mkdtempSync(join(tmpdir(), "tf-plugin-cache-"));
  process.env.TF_PLUGIN_CACHE_DIR = cache;

  const reports: MutationReport[] = [];
  try {
    for (const dir of dirs) reports.push(checkModule(dir));
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
    const count = (o: MutationOutcome) => r.results.filter((x) => x.outcome === o).length;
    const scored = count("caught") + count("survived");
    checked += scored;
    survivedTotal += count("survived");
    process.stdout.write(`${r.dir}: ${count("caught")}/${scored} caught, ${count("invalid")} invalid mutant(s)\n`);
    for (const s of r.results.filter((x) => x.outcome === "survived")) {
      process.stdout.write(`  survived: ${s.name} (${s.file}) — ${s.hint}\n`);
    }
  }

  if (survivedTotal > 0) process.exit(1);
  if (checked === 0) process.exit(3);
  process.exit(0);
}

main();
