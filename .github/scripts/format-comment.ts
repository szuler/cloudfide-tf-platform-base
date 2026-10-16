// CLI: render the PR comment (or job summary) markdown from a report JSON file.
// Usage: node scripts/format-comment.ts report.json [comment|summary]
import { readFileSync } from "node:fs";
import { renderComment, renderJobSummary } from "./lib/comment.ts";
import type { Report } from "./lib/types.ts";

function main(): void {
  const path = process.argv[2];
  const mode = process.argv[3] ?? "comment";
  if (!path) {
    process.stderr.write("usage: format-comment <report.json> [comment|summary]\n");
    process.exit(2);
  }
  const report = JSON.parse(readFileSync(path, "utf8")) as Report;
  const out = mode === "summary" ? renderJobSummary(report) : renderComment(report);
  process.stdout.write(`${out}\n`);
}

main();
