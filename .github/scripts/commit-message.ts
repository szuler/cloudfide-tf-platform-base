// CLI: the agent's commit message. The body records the run link and the agent's decisions, so
// the commit itself explains what the agent did even if every PR comment is gone.
// Usage: node scripts/commit-message.ts <agent-report.json> <pr-number> <run-url> > message.txt
import { readFileSync } from "node:fs";
import { commitMessage } from "./lib/ledger.ts";
import type { AgentReport } from "./lib/types.ts";

function main(): void {
  const [reportPath, pr, runUrl] = process.argv.slice(2);
  if (!reportPath || !pr || !runUrl) {
    process.stderr.write("usage: commit-message <agent-report.json> <pr-number> <run-url>\n");
    process.exit(2);
  }
  let report: AgentReport | null = null;
  try {
    report = JSON.parse(readFileSync(reportPath, "utf8")) as AgentReport;
  } catch {
    // No readable report: the message still carries the run link.
  }
  process.stdout.write(commitMessage(report, pr, runUrl));
}

main();
