// CLI: run fmt-check, init, validate and `terraform test` for one or more module
// dirs, printing a structured JSON result. Exit non-zero if any target is not OK.
// Usage: node scripts/run-tests.ts modules/network modules/storage-account
import { existsSync } from "node:fs";
import { join } from "node:path";
import { run, terraformBin } from "./lib/exec.ts";
import { parseTestJson, reportIsPass } from "./lib/tf-report.ts";
import type { ModuleTestResult } from "./lib/types.ts";

function runModule(dir: string): ModuleTestResult {
  const tf = terraformBin();
  const result: ModuleTestResult = {
    dir,
    fmt: "skipped",
    init: "skipped",
    validate: "skipped",
    test: null,
    ok: false,
  };

  const fmt = run(tf, ["fmt", "-check", "-no-color"], dir);
  result.fmt = fmt.code === 0 ? "ok" : "failed";

  const init = run(tf, ["init", "-backend=false", "-no-color", "-input=false"], dir);
  result.init = init.code === 0 ? "ok" : "failed";
  if (init.code !== 0) {
    process.stderr.write(init.stderr);
    return result;
  }

  const validate = run(tf, ["validate", "-no-color"], dir);
  result.validate = validate.code === 0 ? "ok" : "failed";

  if (existsSync(join(dir, "tests"))) {
    const test = run(tf, ["test", "-json"], dir);
    result.test = parseTestJson(test.stdout);
  }

  result.ok =
    result.fmt === "ok" &&
    result.validate === "ok" &&
    (result.test === null || reportIsPass(result.test));
  return result;
}

function main(): void {
  const dirs = process.argv.slice(2);
  if (dirs.length === 0) {
    process.stderr.write("usage: run-tests <module-dir> [<module-dir> ...]\n");
    process.exit(2);
  }
  const results = dirs.map(runModule);
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

main();
