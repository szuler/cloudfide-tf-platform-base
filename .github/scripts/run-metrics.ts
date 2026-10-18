// CLI: write this run's metrics record and its job-summary markdown.
// Usage: node scripts/run-metrics.ts <merged-report.json> --run-url <url> --head <sha> --pr <n> \
//          [--author <execution-file>] [--critic <execution-file>] --json <out.json> --summary <out.md>
// Missing or unreadable inputs are recorded as absent; the step is informational and never fails
// the job on bad data.
import { readFileSync, writeFileSync } from "node:fs";
import { buildMetrics, passMetrics, renderMetrics } from "./lib/metrics.ts";
import type { Report } from "./lib/types.ts";

function readJson(path: string | undefined): unknown {
  if (!path) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function main(): void {
  const [reportPath, ...rest] = process.argv.slice(2);
  const a: Record<string, string> = {};
  for (let i = 0; i < rest.length; i += 2) if (rest[i]?.startsWith("--")) a[rest[i]!.slice(2)] = rest[i + 1] ?? "";
  if (!reportPath || !a.json || !a.summary) {
    process.stderr.write("usage: run-metrics <merged-report.json> --run-url <url> --head <sha> --pr <n> [--author f] [--critic f] --json out --summary out\n");
    process.exit(2);
  }
  const report = (readJson(reportPath) ?? { decisions: [], results: [], findings: [] }) as Report;
  const metrics = buildMetrics(
    report,
    { author: passMetrics(readJson(a.author)), critic: passMetrics(readJson(a.critic)) },
    { runUrl: a["run-url"] ?? "", headSha: a.head ?? "", pr: Number(a.pr) || 0 },
  );
  writeFileSync(a.json, `${JSON.stringify(metrics, null, 2)}\n`);
  writeFileSync(a.summary, `${renderMetrics(metrics)}\n`);
}

main();
