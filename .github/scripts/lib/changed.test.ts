import { test } from "node:test";
import assert from "node:assert/strict";
import { detectChangedTargets, markNewTargets } from "./changed.ts";

test("markNewTargets flags only dirs missing at the base commit", () => {
  const r = markNewTargets(
    detectChangedTargets(["modules/network/main.tf", "modules/brand-new/main.tf"]),
    (dir) => dir === "modules/network",
  );
  assert.equal(r.targets.find((t) => t.dir === "modules/network")?.isNew, false);
  assert.equal(r.targets.find((t) => t.dir === "modules/brand-new")?.isNew, true);
});

test("groups changed files by module", () => {
  const r = detectChangedTargets([
    "modules/storage-account/main.tf",
    "modules/storage-account/tests/main.tftest.hcl",
    "modules/network/variables.tf",
  ]);
  assert.equal(r.targets.length, 2);
  const sa = r.targets.find((t) => t.name === "storage-account");
  assert.ok(sa);
  assert.equal(sa.kind, "module");
  assert.equal(sa.files.length, 2);
});

test("detects stack changes", () => {
  const r = detectChangedTargets(["stacks/data-platform/main.tf"]);
  assert.equal(r.targets.length, 1);
  assert.equal(r.targets[0]?.kind, "stack");
});

test("ignores non-terraform files (negative)", () => {
  const r = detectChangedTargets(["README.md", ".github/workflows/x.yml", "scripts/foo.ts"]);
  assert.equal(r.targets.length, 0);
  assert.equal(r.ignored.length, 3);
});

test("ignores tf files outside modules/stacks (negative)", () => {
  const r = detectChangedTargets(["random/main.tf"]);
  assert.equal(r.targets.length, 0);
  assert.deepEqual(r.ignored, ["random/main.tf"]);
});

test("handles backslash paths and blank lines", () => {
  const r = detectChangedTargets(["modules\\key-vault\\main.tf", "", "  "]);
  assert.equal(r.targets.length, 1);
  assert.equal(r.targets[0]?.dir, "modules/key-vault");
});
