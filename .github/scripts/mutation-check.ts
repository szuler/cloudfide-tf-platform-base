// CLI (optional, local): mutation-test a module's tests. For each applicable mutation, copy
// the module to a temp dir, apply the mutation, run `terraform test`, and expect it to FAIL.
// A mutation the tests still PASS under is a coverage gap ("survived"). Exit 1 if any survived.
// Usage: TERRAFORM_BIN=... node .github/scripts/mutation-check.ts modules/<name>
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { run, terraformBin } from "./lib/exec.ts";
import { parseTestJson, reportIsPass } from "./lib/tf-report.ts";
import { applyMutation, DEFAULT_MUTATIONS, type Mutation } from "./lib/mutate.ts";

interface MutationResult {
  name: string;
  file: string;
  caught: boolean;
}

function tfSourceFiles(dir: string): string[] {
  return readdirSync(dir).filter((f) => f.endsWith(".tf"));
}

/** Find, for each mutation, a source file it applies to (first match wins). */
function applicableMutations(moduleDir: string): Array<{ mutation: Mutation; file: string }> {
  const files = tfSourceFiles(moduleDir);
  const out: Array<{ mutation: Mutation; file: string }> = [];
  for (const mutation of DEFAULT_MUTATIONS) {
    for (const file of files) {
      const content = readFileSync(join(moduleDir, file), "utf8");
      if (applyMutation(content, mutation).applied) {
        out.push({ mutation, file });
        break;
      }
    }
  }
  return out;
}

function runMutation(moduleDir: string, mutation: Mutation, file: string): boolean {
  const tf = terraformBin();
  const tmp = mkdtempSync(join(tmpdir(), `mut-${mutation.name}-`));
  try {
    cpSync(moduleDir, tmp, { recursive: true });
    rmSync(join(tmp, ".terraform"), { recursive: true, force: true });
    rmSync(join(tmp, ".terraform.lock.hcl"), { force: true });

    const target = join(tmp, file);
    writeFileSync(target, applyMutation(readFileSync(target, "utf8"), mutation).result);

    run(tf, ["init", "-backend=false", "-no-color", "-input=false"], tmp);
    const test = run(tf, ["test", "-json"], tmp);
    // Tests SHOULD fail on a mutation -> caught. If they still pass -> survived (gap).
    return !reportIsPass(parseTestJson(test.stdout));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function main(): void {
  const moduleDir = process.argv[2];
  if (!moduleDir) {
    process.stderr.write("usage: mutation-check <module-dir>\n");
    process.exit(2);
  }
  if (!existsSync(join(moduleDir, "tests"))) {
    process.stderr.write(`${moduleDir} has no tests/ directory — nothing to mutation-check.\n`);
    process.exit(2);
  }

  // Share one provider cache across all inits so we download the provider only once.
  const cache = mkdtempSync(join(tmpdir(), "tf-plugin-cache-"));
  process.env.TF_PLUGIN_CACHE_DIR = cache;

  const applicable = applicableMutations(moduleDir);
  if (applicable.length === 0) {
    process.stdout.write(`No applicable mutations for ${moduleDir}.\n`);
    process.exit(0);
  }

  const results: MutationResult[] = [];
  try {
    for (const { mutation, file } of applicable) {
      const caught = runMutation(moduleDir, mutation, file);
      results.push({ name: mutation.name, file, caught });
      process.stdout.write(`  ${caught ? "caught " : "SURVIVED"}  ${mutation.name} (${file})\n`);
    }
  } finally {
    rmSync(cache, { recursive: true, force: true });
  }

  const survived = results.filter((r) => !r.caught);
  process.stdout.write(
    `\nMutation check for ${moduleDir}: ${results.length - survived.length}/${results.length} caught.\n`,
  );
  if (survived.length > 0) {
    process.stdout.write(
      `Survived (coverage gaps): ${survived.map((s) => s.name).join(", ")}\n`,
    );
    process.exit(1);
  }
  process.exit(0);
}

main();
