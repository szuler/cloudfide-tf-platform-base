import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyComments,
  commitMessage,
  countRunBlocks,
  decodeState,
  encodeState,
  LEDGER_MARKER,
  LEDGER_URL_PLACEHOLDER,
  LEGACY_MARKER,
  MAX_COMMENT_CHARS,
  renderLedger,
  RUN_COMMENT_URL_PLACEHOLDER,
  runCommentUrls,
  renderRunComment,
  rowFromReport,
  RUN_MARKER,
  testChanges,
  updateLedger,
} from "./ledger.ts";
import type { AgentCommit, LedgerRow, Report } from "./types.ts";

const TEST_FILE = "modules/data-factory/tests/main.tftest.hcl";

const report: Report = {
  decisions: [{ target: "modules/data-factory", action: "created", reason: "new variable" }],
  results: [
    {
      dir: "modules/data-factory",
      fmt: "ok",
      init: "ok",
      validate: "ok",
      test: { summary: { status: "pass", passed: 5, failed: 0, errored: 0, skipped: 0 }, runs: [], diagnostics: [], parseErrors: 0 },
      ok: true,
    },
  ],
  findings: [],
  testReview: [{ file: TEST_FILE, run: "r", verdict: "strengthen", reason: "x", applied: true }],
  mutations: [
    {
      dir: "modules/data-factory",
      results: [
        { name: "a", file: "main.tf", outcome: "caught", hint: "" },
        { name: "b", file: "main.tf", outcome: "survived", hint: "" },
        { name: "c", file: "main.tf", outcome: "invalid", hint: "" },
      ],
    },
  ],
};

const ctx = { runId: "100", runUrl: "https://example/runs/100", headSha: "aaaaaaa1", changes: [] };

// ── git facts ──

test("counts run blocks added and removed per file", () => {
  const diff = [
    `diff --git a/${TEST_FILE} b/${TEST_FILE}`,
    `--- a/${TEST_FILE}`,
    `+++ b/${TEST_FILE}`,
    "@@ -1,0 +1,9 @@",
    '+run "one" {',
    '+  run "nested_not_a_block_start_but_counted_anyway" {',
    '-run "old" {',
    "+  command = plan",
  ].join("\n");
  assert.deepEqual(countRunBlocks(diff).get(TEST_FILE), { added: 2, removed: 1 });
});

test("a deleted file's removed runs count under its old path (edge)", () => {
  const diff = [`diff --git a/${TEST_FILE} b/${TEST_FILE}`, `--- a/${TEST_FILE}`, "+++ /dev/null", "@@ -1,3 +0,0 @@", '-run "gone" {'].join("\n");
  assert.deepEqual(countRunBlocks(diff).get(TEST_FILE), { added: 0, removed: 1 });
});

test("a removed line starting with dashes inside a hunk is not a file header (negative)", () => {
  const diff = [`diff --git a/${TEST_FILE} b/${TEST_FILE}`, `--- a/${TEST_FILE}`, `+++ b/${TEST_FILE}`, "@@ -1 +1 @@", "--- not a header", '+run "x" {'].join("\n");
  assert.deepEqual(countRunBlocks(diff).get(TEST_FILE), { added: 1, removed: 0 });
});

test("testChanges keeps test files only and maps git status", () => {
  const nameStatus = [`A\t${TEST_FILE}`, "A\tmodules/data-factory/.terraform.lock.hcl", "M\tmodules/net/tests/x.tftest.hcl"].join("\n");
  const diff = [`diff --git a/${TEST_FILE} b/${TEST_FILE}`, "--- /dev/null", `+++ b/${TEST_FILE}`, "@@ -0,0 +1 @@", '+run "a" {'].join("\n");
  assert.deepEqual(testChanges(nameStatus, diff), [
    { path: TEST_FILE, status: "created", runsAdded: 1, runsRemoved: 0 },
    { path: "modules/net/tests/x.tftest.hcl", status: "updated", runsAdded: 0, runsRemoved: 0 },
  ]);
});

// ── state ──

test("state round-trips and survives text that would close an HTML comment", () => {
  const ledger = { rows: [{ source: "run" as const, changes: [], decisions: [{ target: "t", action: "created" as const, reason: "a --> b" }] }] };
  assert.deepEqual(decodeState(`intro\n${encodeState(ledger)}\n`), ledger);
});

test("missing or corrupted state decodes to null (negative)", () => {
  assert.equal(decodeState("no state here"), null);
  assert.equal(decodeState("<!-- tf-test-agent:state not-base64-json -->"), null);
});

// ── comments ──

test("classifies ledger, legacy and run comments", () => {
  const c = (id: number, body: string) => ({ id, node_id: `n${id}`, html_url: `u${id}`, body });
  const withLegacy = classifyComments([c(1, `${LEGACY_MARKER}\nold`), c(2, `${RUN_MARKER}\nrun`)]);
  assert.equal(withLegacy.legacy?.id, 1);
  assert.equal(withLegacy.ledger, undefined);
  assert.deepEqual(withLegacy.runs.map((r) => r.id), [2]);

  // Once a ledger exists, the legacy marker is no longer adopted.
  const withLedger = classifyComments([c(1, `${LEDGER_MARKER}\n`), c(3, `${LEGACY_MARKER}`)]);
  assert.equal(withLedger.ledger?.id, 1);
  assert.equal(withLedger.legacy, undefined);
});

// ── rows and ledger ──

test("a row summarises tests, mutations (invalid not scored), critic and decisions", () => {
  const row = rowFromReport(report, ctx);
  assert.equal(row.status, "ok");
  assert.deepEqual(row.tests, { passed: 5, total: 5 });
  assert.deepEqual(row.mutation, { caught: 1, scored: 2 });
  assert.deepEqual(row.review, { keep: 0, strengthen: 1, drop: 0 });
  assert.equal(row.decisions?.[0]?.target, "modules/data-factory");
});

test("the ledger's mutation score is the headline score, not the whole module", () => {
  const row = rowFromReport(
    {
      ...report,
      mutations: [
        {
          dir: "modules/data-factory",
          scope: "change",
          results: [
            { name: "a", file: "main.tf", inChange: true, outcome: "survived", hint: "" },
            { name: "b", file: "main.tf", inChange: false, outcome: "caught", hint: "" },
          ],
        },
      ],
    },
    ctx,
  );
  assert.deepEqual(row.mutation, { caught: 0, scored: 1 });
});

test("a report with problems makes a failed row (negative)", () => {
  const row = rowFromReport({ ...report, problems: ["No decision recorded for `x`."] }, ctx);
  assert.equal(row.status, "failed");
  assert.deepEqual(row.problems, ["No decision recorded for `x`."]);
});

const commit1: AgentCommit = {
  sha: "c1c1c1c1",
  parent: "e8e8e8e8",
  changes: [{ path: TEST_FILE, status: "created", runsAdded: 5, runsRemoved: 0 }],
};

test("migration: first ledger rebuilds the earlier run from git and keeps the old comment", () => {
  const current = rowFromReport(report, ctx);
  const ledger = updateLedger(null, current, [commit1], `${LEGACY_MARKER}\n## old report`);
  assert.equal(ledger.rows.length, 2);
  assert.equal(ledger.rows[0]?.source, "history");
  assert.equal(ledger.rows[0]?.agentCommit, "c1c1c1c1");
  assert.equal(ledger.rows[0]?.legacyBody, "## old report");
  assert.equal(ledger.rows[1], current);
});

test("later runs append; the agent's own commits are not duplicated as history", () => {
  const first = rowFromReport(report, { ...ctx, agentCommit: "c1c1c1c1", changes: commit1.changes });
  const l1 = updateLedger(null, first, [commit1]);
  const second = rowFromReport(report, { ...ctx, runId: "200" });
  const l2 = updateLedger(l1, second, [commit1]);
  assert.deepEqual(l2.rows.map((r) => r.runId), ["100", "200"]);
});

test("a re-run of the same workflow run replaces its row (edge)", () => {
  const l1 = updateLedger(null, rowFromReport(report, ctx), []);
  const l2 = updateLedger(l1, rowFromReport({ ...report, problems: ["x"] }, ctx), []);
  assert.equal(l2.rows.length, 1);
  assert.equal(l2.rows[0]?.status, "failed");
});

test("ledger shows what the agent did even when the latest run changed nothing", () => {
  const first = rowFromReport(report, { ...ctx, agentCommit: "c1c1c1c1", changes: commit1.changes });
  const second = rowFromReport(report, { ...ctx, runId: "200", runUrl: "https://example/runs/200" });
  const md = renderLedger({ rows: [first, second] }, new Set(["c1c1c1c1"]));
  assert.ok(md.startsWith(LEDGER_MARKER));
  assert.ok(md.includes(`\`${TEST_FILE}\` created (+5 runs)`));
  assert.ok(md.includes("| [2](https://example/runs/200) | `aaaaaaa` | ✅ 5/5 | no test changes | 1/2 |"));
  assert.ok(decodeState(md)?.rows.length === 2);
});

test("an agent commit dropped by a force-push keeps its row, flagged (edge)", () => {
  const row = rowFromReport(report, { ...ctx, agentCommit: "c1c1c1c1", changes: commit1.changes });
  const md = renderLedger({ rows: [row] }, new Set());
  assert.ok(md.includes("_(no longer on the branch)_"));
  assert.ok(md.includes("created (+5 runs)"));
});

test("an oversized ledger drops the oldest details and state bulk but keeps every table row", () => {
  const big: LedgerRow = { source: "history", changes: [], legacyBody: "x".repeat(MAX_COMMENT_CHARS) };
  const rows: LedgerRow[] = [big, rowFromReport(report, ctx)];
  const md = renderLedger({ rows }, new Set());
  assert.ok(md.length <= MAX_COMMENT_CHARS);
  assert.ok(md.includes("| 1 _(earlier run)_"));
  assert.ok(md.includes("Run 2 — decisions"));
  assert.equal(decodeState(md)?.rows.length, 2);
  assert.equal(rows[0]?.legacyBody?.length, MAX_COMMENT_CHARS); // caller's ledger untouched
});

test("an adopted legacy comment is capped (edge)", () => {
  const ledger = updateLedger(null, rowFromReport(report, ctx), [], "y".repeat(50_000));
  assert.ok((ledger.rows[0]?.legacyBody?.length ?? 0) < 21_000);
});

test("each test change says which pass made it", () => {
  const row = rowFromReport(report, {
    ...ctx,
    agentCommit: "c1c1c1c1",
    changes: [
      { path: TEST_FILE, status: "updated", runsAdded: 1, runsRemoved: 0 },
      { path: "modules/data-factory/tests/extra.tftest.hcl", status: "created", runsAdded: 2, runsRemoved: 0 },
    ],
    changedBy: { author: ["modules/data-factory/tests/extra.tftest.hcl", TEST_FILE], critic: [TEST_FILE] },
  });
  const md = renderLedger({ rows: [row] }, new Set(["c1c1c1c1"]));
  assert.ok(md.includes(`\`${TEST_FILE}\` updated (+1 run) · by author + critic`));
  assert.ok(md.includes("`modules/data-factory/tests/extra.tftest.hcl` created (+2 runs) · by author"));
  assert.ok(renderRunComment(report, row, 1).includes("· by author + critic"));
});

test("no attribution label when it was not recorded (older rows)", () => {
  const row = rowFromReport(report, { ...ctx, agentCommit: "c1c1c1c1", changes: commit1.changes });
  assert.ok(!renderLedger({ rows: [row] }, new Set()).includes("· by "));
});

// ── run comment and commit message ──

test("run comment without test changes points the reviewer to the ledger", () => {
  const md = renderRunComment(report, rowFromReport(report, ctx), 2);
  assert.ok(md.startsWith(RUN_MARKER));
  assert.ok(md.includes("— run 2"));
  assert.ok(md.includes(`**No test changes in this run.**`));
  assert.ok(md.includes(LEDGER_URL_PLACEHOLDER));
  assert.ok(!md.includes(LEGACY_MARKER));
});

test("run comment with test changes names the agent commit", () => {
  const row = rowFromReport(report, { ...ctx, agentCommit: "c1c1c1c1", changes: commit1.changes });
  assert.ok(renderRunComment(report, row, 1).includes("**Test changes in this run** (commit `c1c1c1c`)"));
});

test("commit message carries run link, one-line decisions and [skip ci]", () => {
  const msg = commitMessage({ decisions: [{ target: "modules/x", action: "created", reason: "line one\nline two" }] }, "5", "https://r");
  assert.ok(msg.startsWith("test: agent-generated and reviewed tests for PR #5\n"));
  assert.ok(msg.includes("Run: https://r"));
  assert.ok(msg.includes("- modules/x: created — line one line two"));
  assert.ok(msg.includes("[skip ci]"));
  assert.ok(commitMessage(null, "5", "https://r").includes("[skip ci]"));
});

test("run numbers link to their report comments, with the workflow log as a second link", () => {
  const first = rowFromReport(report, { ...ctx, runUrl: "https://example/runs/100" });
  const second = rowFromReport(report, { ...ctx, runId: "200", runUrl: "https://example/runs/200" });
  const urls = runCommentUrls([
    { id: 1, node_id: "n1", html_url: "https://gh/pr/5#issuecomment-1", body: `${RUN_MARKER}\nCommit x · [workflow run](https://example/runs/100) · [PR summary](u)` },
  ]);
  urls.set("https://example/runs/200", RUN_COMMENT_URL_PLACEHOLDER);
  const md = renderLedger({ rows: [first, second] }, new Set(), urls);
  assert.ok(md.includes("| [1](https://gh/pr/5#issuecomment-1) · [log](https://example/runs/100) |"));
  assert.ok(md.includes(`| [2](${RUN_COMMENT_URL_PLACEHOLDER}) · [log](https://example/runs/200) |`));
  assert.ok(md.includes("- [Full report of run 1](https://gh/pr/5#issuecomment-1)"));
});

test("a row whose report comment is gone falls back to the workflow log (edge)", () => {
  const row = rowFromReport(report, { ...ctx, runUrl: "https://example/runs/100" });
  const md = renderLedger({ rows: [row] }, new Set(), runCommentUrls([]));
  assert.ok(md.includes("| [1](https://example/runs/100) |"));
  assert.ok(!md.includes("Full report of run"));
});

test("no plain #N outside links: GitHub would autolink it to issue/PR N (negative)", () => {
  const rows = [
    { source: "history" as const, agentCommit: "c1c1c1c1", changes: commit1.changes, legacyBody: "old report" },
    rowFromReport(report, { ...ctx, runUrl: "https://example/runs/200" }),
  ];
  const urls = new Map([["https://example/runs/200", "https://gh/pr/5#issuecomment-9"]]);
  const outsideLinks = (md: string) =>
    md.replace(/\[[^\]]*\]\([^)]*\)/g, "").replace(/https?:\/\/\S+/g, "").replace(/<!--[\s\S]*?-->/g, "");
  assert.doesNotMatch(outsideLinks(renderLedger({ rows }, new Set(["c1c1c1c1"]), urls)), /(^|[^\w&])#\d/m);
  assert.doesNotMatch(outsideLinks(renderRunComment(report, rows[1]!, 2)), /(^|[^\w&])#\d/m);
});

test("a rerun keeps an earlier attempt that changed tests, labelled", () => {
  const first = rowFromReport(report, { ...ctx, runUrl: "https://r/runs/100/attempts/1", agentCommit: "c1c1c1c1", changes: commit1.changes });
  const second = rowFromReport(report, { ...ctx, runUrl: "https://r/runs/100/attempts/2" });
  const ledger = updateLedger(updateLedger(null, first, [commit1]), second, [commit1]);
  assert.equal(ledger.rows.length, 2);
  assert.equal(ledger.rows[0]?.earlierAttempt, true);
  const md = renderLedger(ledger, new Set(["c1c1c1c1"]));
  assert.ok(md.includes("| [1](https://r/runs/100/attempts/1) _(earlier attempt)_ |"));
  assert.ok(md.includes("| [2](https://r/runs/100/attempts/2) |"));
});

test("agent commits with no test change (lock file only) are not runs (PR 11 case)", () => {
  const lockOnly: AgentCommit = { sha: "1occ0000", parent: "bccbde90", changes: [] };
  // What PR 11's ledger stored after the failed attempt and its rerun:
  const stored = { rows: [{ source: "history" as const, headSha: "bccbde90", agentCommit: "1occ0000", changes: [] }, rowFromReport(report, ctx)] };
  const next = rowFromReport(report, { ...ctx, runId: "200" });
  const ledger = updateLedger(stored, next, [lockOnly]);
  assert.deepEqual(ledger.rows.map((r) => r.runId), ["100", "200"]);
  assert.equal(updateLedger(null, next, [lockOnly]).rows.length, 1);
});

test("attempt-specific run URLs keep two attempts' comments apart (edge)", () => {
  const c = (id: number, url: string) => ({ id, node_id: `n${id}`, html_url: `https://gh/c${id}`, body: `${RUN_MARKER}\n[workflow run](${url}) · [PR summary](u)` });
  const urls = runCommentUrls([c(1, "https://r/runs/100/attempts/1"), c(2, "https://r/runs/100/attempts/2")]);
  assert.equal(urls.get("https://r/runs/100/attempts/1"), "https://gh/c1");
  assert.equal(urls.get("https://r/runs/100/attempts/2"), "https://gh/c2");
});
