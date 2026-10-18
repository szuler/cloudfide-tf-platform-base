import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMetrics, passMetrics, renderMetrics } from "./metrics.ts";
import type { Report } from "./types.ts";

// Trimmed from real result messages: PR #13's author pass, and PR #11's first attempt, which hit
// the workspace API usage limit.
const authorOk = [
  { type: "system", subtype: "init" },
  {
    type: "result",
    subtype: "success",
    is_error: false,
    terminal_reason: "completed",
    num_turns: 17,
    duration_ms: 149391,
    duration_api_ms: 140396,
    total_cost_usd: 0.3125677,
    usage: { input_tokens: 9, cache_creation_input_tokens: 27504, cache_read_input_tokens: 256520, output_tokens: 8816 },
    permission_denials: [],
  },
];
const authorApiLimit = [
  { type: "result", subtype: "success", is_error: true, terminal_reason: "api_error", num_turns: 1, total_cost_usd: 0 },
];

const report: Report = {
  decisions: [
    { target: "modules/a", action: "skipped", reportedAction: "created", reason: "r" },
    { target: "modules/b", action: "updated", reason: "r" },
  ],
  results: [
    {
      dir: "modules/a",
      fmt: "ok",
      init: "ok",
      validate: "ok",
      ok: true,
      test: { summary: { status: "pass", passed: 7, failed: 0, errored: 0, skipped: 0 }, runs: [], diagnostics: [], parseErrors: 0 },
    },
  ],
  findings: [
    { file: "f", severity: "medium", confidence: "fact", title: "t", detail: "d" },
    { file: "f", severity: "info", confidence: "likely", title: "t", detail: "d" },
  ],
  testReview: [
    { file: "f", run: "a", verdict: "keep", reason: "r" },
    { file: "f", run: "b", verdict: "strengthen", reason: "r", applied: true },
  ],
  mutations: [
    {
      dir: "modules/a",
      scope: "suite-created",
      results: [
        { name: "m1", file: "main.tf", outcome: "caught", hint: "" },
        { name: "m2", file: "main.tf", outcome: "survived", hint: "" },
        { name: "m3", file: "main.tf", outcome: "invalid", hint: "" },
      ],
    },
  ],
  warnings: ["w"],
};
const ctx = { runUrl: "https://r/runs/1/attempts/1", headSha: "abc", pr: 13 };

test("reads a pass's cost, time, turns and tokens from its result message", () => {
  const p = passMetrics(authorOk)!;
  assert.equal(p.costUsd, 0.3125677);
  assert.equal(p.turns, 17);
  assert.equal(p.cacheReadTokens, 256520);
  assert.equal(p.terminalReason, "completed");
  assert.equal(p.isError, false);
  assert.equal(p.permissionDenials, 0);
});

test("a failed pass is recorded with its reason; a missing one is null (negative)", () => {
  const p = passMetrics(authorApiLimit)!;
  assert.equal(p.isError, true);
  assert.equal(p.terminalReason, "api_error");
  assert.equal(p.costUsd, 0);
  assert.equal(passMetrics(null), null);
  assert.equal(passMetrics([{ type: "assistant" }]), null);
});

test("a run record sums the passes and collects the quality signals", () => {
  const m = buildMetrics(report, { author: passMetrics(authorOk), critic: passMetrics(authorOk) }, ctx);
  assert.equal(m.cost.totalUsd, 0.6251);
  assert.equal(m.performance.agentTurns, 34);
  assert.equal(m.cost.cacheReadShare, 0.903); // 256520 / (9 + 27504 + 256520)
  assert.deepEqual(m.quality.mutation, { caught: 1, scored: 2 }); // invalid mutants not scored
  assert.deepEqual(m.quality.critic, { keep: 1, strengthen: 1, drop: 0, applied: 1 });
  assert.equal(m.quality.labelCorrections, 1);
  assert.deepEqual(m.quality.findingsBySeverity, { high: 0, medium: 1, low: 0, info: 1 });
  assert.deepEqual(m.quality.findingsByConfidence, { fact: 1, likely: 1 });
  assert.equal(m.quality.testsPassed, 7);
});

test("a run without a critic or mutations records them as absent, not as zero (edge)", () => {
  const m = buildMetrics({ decisions: [], results: [], findings: [] }, { author: passMetrics(authorApiLimit) }, ctx);
  assert.equal(m.quality.critic, null);
  assert.equal(m.quality.mutation, null);
  assert.equal(m.passes.critic, undefined);
  const md = renderMetrics(m);
  assert.ok(md.includes("| author | $0.000 | 0 s | 1 |"));
  assert.ok(md.includes("❌ api_error"));
  assert.ok(md.includes("| critic | — | — | — | — | — | not run |"));
});
