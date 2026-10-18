import { test } from "node:test";
import assert from "node:assert/strict";
import { compareMutations, parseNumstat, renderAudit } from "./audit.ts";
import type { MutationReport } from "./types.ts";

// Shaped like the real storage-account result on main (4/7, three survivors).
const before: MutationReport = {
  dir: "modules/storage-account",
  scope: "module",
  results: [
    { name: "tls-downgrade", file: "main.tf", line: 10, outcome: "caught", hint: "h" },
    { name: "shared-key-on", file: "main.tf", line: 13, outcome: "survived", hint: "no test guards against shared-key auth" },
    { name: "https-traffic-off", file: "main.tf", line: 11, outcome: "survived", hint: "no test guards HTTPS-only traffic" },
    { name: "bool-default-on", file: "variables.tf", line: 30, outcome: "survived", hint: "no test pins this `false` default" },
  ],
};
const after: MutationReport = {
  ...before,
  results: [
    { name: "tls-downgrade", file: "main.tf", line: 10, outcome: "caught", hint: "h" },
    { name: "shared-key-on", file: "main.tf", line: 13, outcome: "caught", hint: "h" },
    { name: "https-traffic-off", file: "main.tf", line: 11, outcome: "caught", hint: "h" },
    { name: "bool-default-on", file: "variables.tf", line: 30, outcome: "survived", hint: "no test pins this `false` default" },
  ],
};

test("parses git diff --numstat, binary files counting as zero lines", () => {
  assert.deepEqual(parseNumstat("12\t3\tmodules/x/tests/main.tftest.hcl\n-\t-\tmodules/x/tests/blob.bin\n\n"), {
    files: 2,
    added: 12,
    removed: 3,
  });
  assert.deepEqual(parseNumstat(""), { files: 0, added: 0, removed: 0 });
});

test("lists the gaps the proposals closed and the ones that remain", () => {
  const c = compareMutations(before, after);
  assert.deepEqual(c.closed.map((m) => m.name), ["shared-key-on", "https-traffic-off"]);
  assert.deepEqual(c.remaining.map((m) => m.name), ["bool-default-on"]);
  assert.deepEqual(c.regressed, []);
});

test("a proposal that lets a previously caught mutant through is flagged (negative)", () => {
  const worse: MutationReport = { ...before, results: before.results.map((m) => (m.name === "tls-downgrade" ? { ...m, outcome: "survived" as const } : m)) };
  assert.deepEqual(compareMutations(before, worse).regressed.map((m) => m.name), ["tls-downgrade"]);
  assert.ok(renderAudit({ module: "m", before, after: worse, patch: { files: 1, added: 1, removed: 9 }, testsOk: true }).includes("weakened the suite"));
});

test("the summary shows before → after and the patch verdict", () => {
  const md = renderAudit({ module: "modules/storage-account", before, after, patch: { files: 1, added: 40, removed: 0 }, testsOk: true });
  assert.ok(md.includes("| Existing suite | 1/4 caught |"));
  assert.ok(md.includes("| With the proposals | 3/4 caught |"));
  assert.ok(md.includes("+40 / −0 lines — ✅ the proposed suite passes"));
  assert.ok(md.includes("✅ now caught: `shared-key-on` (`main.tf:13`)"));
  assert.ok(md.includes("⚠️ still survives: `bool-default-on`"));
  assert.ok(md.includes("not committed"));
});

test("no proposals and no applicable mutation are stated, not hidden (edge)", () => {
  const none: MutationReport = { dir: "m", results: [], note: "no applicable mutation — not checked" };
  const md = renderAudit({ module: "m", before: none, after: none, patch: { files: 0, added: 0, removed: 0 }, testsOk: true });
  assert.ok(md.includes("No test changes proposed"));
  assert.ok(md.includes("| Existing suite | no applicable mutation — not checked |"));
});
