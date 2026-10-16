import { test } from "node:test";
import assert from "node:assert/strict";
import { applyMutation, DEFAULT_MUTATIONS } from "./mutate.ts";

test("applies a TLS downgrade", () => {
  const r = applyMutation('  min_tls_version = "TLS1_2"\n', DEFAULT_MUTATIONS[0]!);
  assert.equal(r.applied, true);
  assert.ok(r.result.includes('"TLS1_0"'));
});

test("is a no-op when the pattern is absent (negative)", () => {
  const r = applyMutation("account_tier = \"Standard\"\n", DEFAULT_MUTATIONS[0]!);
  assert.equal(r.applied, false);
  assert.equal(r.result, "account_tier = \"Standard\"\n");
});

test("boolean mutation preserves spacing via backref", () => {
  const m = DEFAULT_MUTATIONS.find((x) => x.name === "shared-key-on")!;
  const r = applyMutation("  shared_access_key_enabled       = false\n", m);
  assert.equal(r.applied, true);
  assert.ok(r.result.includes("shared_access_key_enabled       = true"));
});
