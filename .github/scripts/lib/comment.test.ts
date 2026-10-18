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

test("problems and warnings render above the results, results still shown", () => {
  const md = renderComment({
    ...baseReport,
    problems: ["The agent did not produce a report"],
    warnings: ["author pass: 2 tool call(s) were blocked"],
  });
  assert.ok(md.includes("Agent run incomplete"));
  assert.ok(md.indexOf("did not produce a report") < md.indexOf("### Decisions"));
  assert.ok(md.includes("2 tool call(s) were blocked"));
  assert.ok(md.includes("4 passed"));
});

test("missing decisions under a problem are not rendered as 'nothing to do' (negative)", () => {
  const md = renderComment({ ...baseReport, decisions: [], problems: ["no report"] });
  assert.ok(md.includes("No decisions recorded"));
  assert.ok(!md.includes("No Terraform changes required test updates"));
});

test("decision shows git's new/existing fact and labels the action as about tests", () => {
  const existing = renderComment({
    ...baseReport,
    decisions: [{ target: "modules/network", action: "created", reason: "r", targetIsNew: false }],
  });
  assert.ok(existing.includes("**modules/network** _(existing)_ — tests created: r"));
  const fresh = renderComment({
    ...baseReport,
    decisions: [{ target: "modules/x", action: "created", reason: "r", targetIsNew: true }],
  });
  assert.ok(fresh.includes("_(new in this PR)_"));
});

test("mutation check lists survivors and does not count invalid mutants", () => {
  const md = renderComment({
    ...baseReport,
    mutations: [
      {
        dir: "modules/data-factory",
        results: [
          { name: "dynamic-value-corrupt", file: "main.tf", outcome: "survived", hint: "counts, not values" },
          { name: "validation-disabled", file: "variables.tf", outcome: "caught", hint: "h" },
          { name: "count-flip", file: "main.tf", outcome: "invalid", hint: "h" },
        ],
      },
      { dir: "modules/network", results: [], note: "no applicable mutation — not checked" },
    ],
  });
  assert.ok(md.includes("### Mutation check (informational)"));
  assert.ok(md.includes("`modules/data-factory` — whole module: 1/2 caught, 1 invalid mutant(s) ignored"));
  assert.ok(md.includes("survived `dynamic-value-corrupt` (`main.tf`) — counts, not values"));
  assert.ok(md.includes("`modules/network`: no applicable mutation — not checked"));
});

test("a suite created in the PR is judged whole, with no 'rest of module' part", () => {
  const md = renderComment({
    ...baseReport,
    mutations: [
      {
        dir: "modules/data-factory",
        scope: "suite-created",
        results: [
          { name: "each-value-corrupt", file: "main.tf", line: 20, inChange: false, outcome: "survived", hint: "h" },
          { name: "validation-disabled", file: "variables.tf", line: 33, inChange: true, outcome: "caught", hint: "h" },
        ],
      },
    ],
  });
  assert.ok(md.includes("— tests created in this PR (the whole suite is new, so every mutant judges it): 1/2 caught"));
  assert.ok(md.includes("survived `each-value-corrupt` (`main.tf:20`)"));
  assert.ok(!md.includes("Rest of the module"));
});

test("an existing suite: changed code is the headline, the rest is collapsed", () => {
  const md = renderComment({
    ...baseReport,
    mutations: [
      {
        dir: "modules/data-factory",
        scope: "change",
        results: [
          { name: "dynamic-value-corrupt", file: "main.tf", line: 33, inChange: true, outcome: "survived", hint: "h" },
          { name: "bool-default-off", file: "variables.tf", line: 19, inChange: false, outcome: "survived", hint: "h" },
          { name: "count-flip", file: "main.tf", line: 5, inChange: false, outcome: "caught", hint: "h" },
        ],
      },
    ],
  });
  assert.ok(md.includes("— code changed in this PR: 0/1 caught"));
  assert.ok(md.includes("<details><summary>Rest of the module (pre-existing tests): 1/2 caught</summary>"));
  const headline = md.slice(0, md.indexOf("<details>"));
  assert.ok(headline.includes("`dynamic-value-corrupt`") && !headline.includes("`bool-default-off`"));
});

test("an existing suite with no mutant on the changed lines says so (edge)", () => {
  const md = renderComment({
    ...baseReport,
    mutations: [
      { dir: "modules/x", scope: "change", results: [{ name: "count-flip", file: "main.tf", inChange: false, outcome: "caught", hint: "h" }] },
    ],
  });
  assert.ok(md.includes("`modules/x` — code changed in this PR: no mutation applies to the changed lines"));
});

test("no mutation section when the check did not run", () => {
  assert.ok(!renderComment(baseReport).includes("Mutation check"));
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
