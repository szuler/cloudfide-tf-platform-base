import { test } from "node:test";
import assert from "node:assert/strict";
import { countPermissionDenials, mergeReport } from "./merge.ts";
import type { AgentReport } from "./types.ts";

const agent: AgentReport = {
  decisions: [{ target: "modules/network", action: "updated", reason: "new variable" }],
  findings: [],
};

test("complete agent report merges without problems", () => {
  const r = mergeReport({ agent, results: [], targets: [{ dir: "modules/network", isNew: false }], denials: { author: 0 } });
  assert.equal(r.problems, undefined);
  assert.equal(r.warnings, undefined);
  assert.equal(r.decisions.length, 1);
});

test("missing agent report is a problem, not an empty success (negative)", () => {
  const r = mergeReport({ agent: null, results: [], targets: [{ dir: "modules/network", isNew: false }], denials: {} });
  assert.equal(r.problems?.length, 1);
  assert.match(r.problems?.[0] ?? "", /did not produce a report/);
  assert.deepEqual(r.decisions, []);
});

test("each target without a decision is reported", () => {
  const r = mergeReport({
    agent,
    results: [],
    targets: [{ dir: "modules/network" }, { dir: "modules/key-vault" }],
    denials: {},
  });
  assert.deepEqual(r.problems, ["No decision recorded for `modules/key-vault`."]);
});

test("permission denials become warnings per pass", () => {
  const r = mergeReport({ agent, results: [], targets: [{ dir: "modules/network", isNew: false }], denials: { author: 3, critic: 0 } });
  assert.equal(r.problems, undefined);
  assert.equal(r.warnings?.length, 1);
  assert.match(r.warnings?.[0] ?? "", /^author pass: 3 tool call/);
});

test("git's new-vs-existing fact is attached to decisions, overriding the agent", () => {
  const claimsNew: AgentReport = {
    decisions: [{ target: "modules/network", action: "created", reason: "New module", targetIsNew: true }],
  };
  const r = mergeReport({
    agent: claimsNew,
    results: [],
    targets: [{ dir: "modules/network", isNew: false }],
    denials: {},
  });
  assert.equal(r.decisions[0]?.targetIsNew, false);
});

test("mutation results pass through and never become problems", () => {
  const mutations = [
    { dir: "modules/network", results: [{ name: "count-flip", file: "main.tf", outcome: "survived" as const, hint: "h" }] },
  ];
  const r = mergeReport({ agent, results: [], targets: [{ dir: "modules/network", isNew: false }], denials: {}, mutations });
  assert.equal(r.problems, undefined);
  assert.deepEqual(r.mutations, mutations);
});

test("countPermissionDenials reads the result message of an execution file", () => {
  const execution = [
    { type: "system", subtype: "init" },
    { type: "assistant" },
    { type: "result", permission_denials: [{ tool_name: "Write" }, { tool_name: "Bash" }] },
  ];
  assert.equal(countPermissionDenials(execution), 2);
});

test("countPermissionDenials tolerates unknown shapes (edge)", () => {
  assert.equal(countPermissionDenials(null), 0);
  assert.equal(countPermissionDenials({ type: "result" }), 0);
  assert.equal(countPermissionDenials("garbage"), 0);
});

test("step warnings are carried into the report as warnings, not problems", () => {
  const r = mergeReport({ agent, results: [], targets: [{ dir: "modules/network", isNew: false }], denials: {}, notes: ["critic pass: edits undone"] });
  assert.equal(r.problems, undefined);
  assert.deepEqual(r.warnings, ["critic pass: edits undone"]);
});

test("a decision claiming test changes git does not show is corrected, the claim kept", () => {
  const claims: AgentReport = {
    decisions: [
      { target: "modules/network", action: "created", reason: "r" },
      { target: "modules/key-vault", action: "updated", reason: "r" },
    ],
  };
  const r = mergeReport({
    agent: claims,
    results: [],
    targets: [{ dir: "modules/network" }, { dir: "modules/key-vault" }],
    denials: {},
    authorTestChanges: ["modules/key-vault/tests/main.tftest.hcl"],
  });
  assert.equal(r.decisions[0]?.action, "skipped");
  assert.equal(r.decisions[0]?.reportedAction, "created");
  assert.equal(r.decisions[1]?.action, "updated");
  assert.equal(r.decisions[1]?.reportedAction, undefined);
});

test("unknown author changes (no snapshot) leave decisions as reported (negative)", () => {
  const r = mergeReport({ agent, results: [], targets: [{ dir: "modules/network" }], denials: {} });
  assert.equal(r.decisions[0]?.action, "updated");
  const empty = mergeReport({ agent, results: [], targets: [{ dir: "modules/network" }], denials: {}, authorTestChanges: [] });
  assert.equal(empty.decisions[0]?.action, "skipped");
});

test("a target prefix does not match a sibling module (edge)", () => {
  const r = mergeReport({
    agent: { decisions: [{ target: "modules/net", action: "updated", reason: "r" }] },
    results: [],
    targets: [{ dir: "modules/net" }],
    denials: {},
    authorTestChanges: ["modules/network/tests/main.tftest.hcl"],
  });
  assert.equal(r.decisions[0]?.action, "skipped");
});
