// CLI: render the audit summary from the mutation results before and after the agent's
// proposals, and the proposal's `git diff --numstat`.
// Usage: node scripts/audit-summary.ts <module> <mutation-before.json> <mutation-after.json> \
//          <proposal.numstat> <tests-ok: true|false> > summary.md
import { readFileSync } from "node:fs";
import { parseNumstat, renderAudit } from "./lib/audit.ts";
import type { MutationReport } from "./lib/types.ts";

function firstReport(path: string | undefined): MutationReport | null {
  try {
    const parsed = JSON.parse(readFileSync(path ?? "", "utf8"));
    return Array.isArray(parsed) && parsed[0] ? (parsed[0] as MutationReport) : null;
  } catch {
    return null;
  }
}

function main(): void {
  const [module, beforePath, afterPath, numstatPath, testsOk] = process.argv.slice(2);
  if (!module || !numstatPath) {
    process.stderr.write("usage: audit-summary <module> <before.json> <after.json> <numstat> <tests-ok>\n");
    process.exit(2);
  }
  let numstat = "";
  try {
    numstat = readFileSync(numstatPath, "utf8");
  } catch {
    // No numstat file: treated as no proposal.
  }
  process.stdout.write(
    `${renderAudit({
      module,
      before: firstReport(beforePath),
      after: firstReport(afterPath),
      patch: parseNumstat(numstat),
      testsOk: testsOk === "true",
    })}\n`,
  );
}

main();
