// Pure logic: parse `terraform test -json` output (one JSON object per line).
// Schema confirmed against real Terraform 1.16.6 output.
import type { RunResult, TestReport, TestSummary } from "./types.ts";

interface JsonLine {
  type?: string;
  "@level"?: string;
  "@message"?: string;
  test_run?: { path: string; run: string; progress: string; status?: string };
  test_summary?: TestSummary;
}

export function parseTestJson(stdout: string): TestReport {
  const runs: RunResult[] = [];
  const diagnostics: string[] = [];
  let summary: TestSummary | null = null;
  let parseErrors = 0;

  for (const line of stdout.split(/\r?\n/)) {
    const text = line.trim();
    if (!text) continue;

    let obj: JsonLine;
    try {
      obj = JSON.parse(text) as JsonLine;
    } catch {
      parseErrors++;
      continue;
    }

    if (obj.type === "test_run" && obj.test_run?.progress === "complete") {
      runs.push({
        file: obj.test_run.path,
        run: obj.test_run.run,
        status: obj.test_run.status ?? "unknown",
      });
    } else if (obj.type === "test_summary" && obj.test_summary) {
      summary = obj.test_summary;
    }

    if ((obj.type === "diagnostic" || obj["@level"] === "error") && obj["@message"]) {
      diagnostics.push(obj["@message"]);
    }
  }

  return { summary, runs, diagnostics: [...new Set(diagnostics)], parseErrors };
}

/** A report is a pass only with an explicit passing summary and zero failures/errors. */
export function reportIsPass(report: TestReport | null): boolean {
  if (!report?.summary) return false;
  return report.summary.status === "pass" && report.summary.failed === 0 && report.summary.errored === 0;
}
