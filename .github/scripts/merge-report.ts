// CLI: merge the agent report with authoritative test results into the final Report, and
// exit non-zero if the agent run did not do its job (missing report or decisions).
// Usage: node scripts/merge-report.ts <agent-report.json> <test-results.json> <changed-targets.json> \
//          [<pass>=<execution-file> ...] > report.json
// Missing/unreadable inputs are treated as "not produced" — that is exactly what we check for.
import { readFileSync } from "node:fs";
import { countPermissionDenials, mergeReport } from "./lib/merge.ts";
import type { AgentReport, DetectResult, ModuleTestResult } from "./lib/types.ts";

function readJson(path: string | undefined): unknown {
  if (!path) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function main(): void {
  const [agentPath, testsPath, targetsPath, ...execArgs] = process.argv.slice(2);
  if (!agentPath || !testsPath || !targetsPath) {
    process.stderr.write("usage: merge-report <agent-report> <test-results> <changed-targets> [pass=exec-file ...]\n");
    process.exit(2);
  }

  const tests = readJson(testsPath);
  const detect = readJson(targetsPath) as DetectResult | null;
  const denials: Record<string, number> = {};
  for (const arg of execArgs) {
    const [pass, file] = arg.split("=", 2);
    if (pass && file) denials[pass] = countPermissionDenials(readJson(file));
  }

  const report = mergeReport({
    agent: readJson(agentPath) as AgentReport | null,
    results: Array.isArray(tests) ? (tests as ModuleTestResult[]) : [],
    targets: detect?.targets ?? [],
    denials,
  });

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  for (const w of report.warnings ?? []) process.stderr.write(`::warning::${w}\n`);
  if (report.problems) {
    for (const p of report.problems) process.stderr.write(`::error::${p}\n`);
    process.exit(1);
  }
}

main();
