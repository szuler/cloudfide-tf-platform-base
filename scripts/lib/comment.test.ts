import { test } from "node:test";
import assert from "node:assert/strict";
import { COMMENT_MARKER, renderComment, renderJobSummary } from "./comment.ts";
import type { Report } from "./types.ts";

const baseReport: Report = {
  decisions: [
    {
      target: "modules/data-factory",
      action: "created",
      reason: "new variable with validation",
      skillsUsed: ["tf-write-tests"],
    },
  ],
  results: [
    {
      dir: "modules/data-factory",
      fmt: "ok",
      init: "ok",
      validate: "ok",
      test: {
        summary: { status: "pass", passed: 4, failed: 0, errored: 0, skipped: 0 },
        runs: [],
        diagnostics: [],
        parseErrors: 0,
      },
      ok: true,
    },
  ],
  findings: [
    {
      file: "modules/function-app/main.tf",
      line: 32,
      severity: "high",
      confidence: "fact",
      title: "FTP is enabled",
      detail: "ftps_state = AllAllowed permits plaintext FTP.",
      suggestion: "Set ftps_state = Disabled.",
    },
  ],
};

test("renders marker, decisions, results and findings", () => {
  const md = renderComment(baseReport);
  assert.ok(md.startsWith(COMMENT_MARKER));
  assert.ok(md.includes("created"));
  assert.ok(md.includes("4 passed"));
  assert.ok(md.includes("FTP is enabled"));
  assert.ok(md.includes("modules/function-app/main.tf:32"));
});

test("notRun short-circuits with a warning (degraded path)", () => {
  const md = renderComment({ ...baseReport, notRun: "no ANTHROPIC_API_KEY secret available" });
  assert.ok(md.includes("did not run"));
  assert.ok(md.includes("no ANTHROPIC_API_KEY"));
  assert.ok(!md.includes("FTP is enabled"));
});

test("no findings renders a placeholder", () => {
  const md = renderComment({ ...baseReport, findings: [] });
  assert.ok(md.includes("No findings"));
});

test("job summary drops the HTML marker", () => {
  const md = renderJobSummary(baseReport);
  assert.ok(!md.includes(COMMENT_MARKER));
  assert.ok(md.includes("Terraform Test Agent"));
});
