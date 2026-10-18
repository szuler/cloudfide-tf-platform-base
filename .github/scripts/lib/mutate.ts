// Pure logic for the mutation check: a small set of security/behaviour mutations, how to
// apply one to a module's Terraform source, and how to score the test run on a mutant.
// A good test suite should FAIL when the code is mutated; a mutation the tests still pass
// under is a coverage gap. Mutations are deliberately plain regexes over HCL text (first
// occurrence only) — crude but transparent, and every one is unit-tested.
import type { MutationOutcome, MutationReport, MutationResult, TestReport } from "./types.ts";
import { reportIsPass } from "./tf-report.ts";

export interface Mutation {
  name: string;
  pattern: RegExp;
  replace: string;
  /** Only apply to source files whose name matches (default: any `.tf` file). */
  files?: RegExp;
  /** What a surviving mutant says about the tests — shown to the reviewer. */
  hint: string;
}

const VARIABLES_TF = /^variables\.tf$/;

export const DEFAULT_MUTATIONS: Mutation[] = [
  // ── security posture: flip a hard-coded safe literal ──────────────────────
  { name: "tls-downgrade", pattern: /"TLS1_2"/, replace: '"TLS1_0"', hint: "no test pins the minimum TLS version" },
  { name: "network-open", pattern: /"Deny"/, replace: '"Allow"', hint: "no test pins the default network action" },
  {
    name: "public-blob-on",
    pattern: /allow_nested_items_to_be_public(\s*=\s*)false/,
    replace: "allow_nested_items_to_be_public$1true",
    hint: "no test guards against public blob access",
  },
  {
    name: "shared-key-on",
    pattern: /shared_access_key_enabled(\s*=\s*)false/,
    replace: "shared_access_key_enabled$1true",
    hint: "no test guards against shared-key auth",
  },
  {
    name: "https-traffic-off",
    pattern: /https_traffic_only_enabled(\s*=\s*)true/,
    replace: "https_traffic_only_enabled$1false",
    hint: "no test guards HTTPS-only traffic",
  },
  {
    name: "https-only-off",
    pattern: /https_only(\s*=\s*)true/,
    replace: "https_only$1false",
    hint: "no test guards HTTPS-only",
  },
  {
    name: "purge-protection-off",
    pattern: /purge_protection_enabled(\s*=\s*)true/,
    replace: "purge_protection_enabled$1false",
    hint: "no test guards purge protection",
  },
  {
    name: "rbac-off",
    pattern: /rbac_authorization_enabled(\s*=\s*)true/,
    replace: "rbac_authorization_enabled$1false",
    hint: "no test guards RBAC authorization",
  },

  // ── behaviour: corrupt how inputs reach the plan ──────────────────────────
  // The suffix keeps values distinct, so the count of blocks/resources stays the same —
  // only an assertion on the values themselves can catch it.
  {
    name: "dynamic-value-corrupt",
    pattern: /(=\s*)((?!each\b)[a-z_][a-z0-9_]*)\.value\b(?![.[])/,
    replace: '$1"$${$2.value}-mut"',
    hint: "tests check how many dynamic blocks there are, not their values",
  },
  {
    name: "each-value-corrupt",
    pattern: /(=\s*)each\.value\b(?![.[])/,
    replace: '$1"$${each.value}-mut"',
    hint: "tests check how many for_each instances there are, not their values",
  },
  {
    // Prefix rather than replace, so a multi-line condition stays valid HCL.
    name: "validation-disabled",
    pattern: /(\bcondition\s*=\s*)/,
    replace: "$1true || ",
    files: VARIABLES_TF,
    hint: "no expect_failures test trips this validation block",
  },
  {
    name: "count-flip",
    pattern: /\?\s*1\s*:\s*0\b/,
    replace: "? 0 : 1",
    hint: "only one branch of a conditional resource is tested",
  },
  {
    name: "bool-default-off",
    pattern: /(\bdefault\s*=\s*)true\b/,
    replace: "$1false",
    files: VARIABLES_TF,
    hint: "no test pins this `true` default",
  },
  {
    name: "bool-default-on",
    pattern: /(\bdefault\s*=\s*)false\b/,
    replace: "$1true",
    files: VARIABLES_TF,
    hint: "no test pins this `false` default",
  },
];

/** Whether a mutation may be applied to a source file with this name. */
export function mutationTargetsFile(m: Mutation, fileName: string): boolean {
  return m.files ? m.files.test(fileName) : fileName.endsWith(".tf");
}

/** Apply the first occurrence of a mutation to file content. */
export function applyMutation(content: string, m: Mutation): { applied: boolean; result: string } {
  if (!m.pattern.test(content)) return { applied: false, result: content };
  return { applied: true, result: content.replace(m.pattern, m.replace) };
}

export interface PlacedMutation {
  applied: boolean;
  result: string;
  line?: number;
  inChange: boolean;
}

/**
 * Apply one occurrence of a mutation, preferring the first one on a changed line, so the
 * mutant tests the PR's change rather than an untouched earlier match. Falls back to the
 * first occurrence anywhere.
 */
export function applyMutationPreferring(content: string, m: Mutation, changed?: Set<number>): PlacedMutation {
  const all = new RegExp(m.pattern.source, m.pattern.flags.includes("g") ? m.pattern.flags : `${m.pattern.flags}g`);
  const lineAt = (index: number) => content.slice(0, index).split("\n").length;
  const matches = [...content.matchAll(all)].map((x) => ({ index: x.index, line: lineAt(x.index) }));
  if (matches.length === 0) return { applied: false, result: content, inChange: false };

  const preferred = matches.find((x) => changed?.has(x.line));
  const pick = preferred ?? matches[0]!;
  // The first match in the tail starting at `pick.index` is exactly `pick`, and lookaheads
  // still see the rest of the file, so a plain non-global replace on the tail is exact.
  const tail = content.slice(pick.index).replace(m.pattern, m.replace);
  return { applied: true, result: content.slice(0, pick.index) + tail, line: pick.line, inChange: preferred !== undefined };
}

/** New-side line numbers touched per file, from `git diff -U0` (paths as git prints them). */
export function parseChangedLines(diff: string): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  let lines: Set<number> | undefined;
  for (const line of diff.split(/\r?\n/)) {
    const file = /^\+\+\+ (?:b\/)?(.+)$/.exec(line);
    if (file) {
      lines = file[1] === "/dev/null" ? undefined : new Set();
      if (lines) out.set(file[1]!, lines);
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk && lines) {
      const start = Number(hunk[1]);
      const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
      for (let n = start; n < start + count; n++) lines.add(n);
    }
  }
  return out;
}

/** The results the headline numbers judge (see `MutationScope`). */
export function headlineResults(r: MutationReport): MutationResult[] {
  return r.scope === "change" ? r.results.filter((x) => x.inChange) : r.results;
}

/** Under scope "change": the mutants on unchanged lines, which judge pre-existing tests. */
export function restResults(r: MutationReport): MutationResult[] {
  return r.scope === "change" ? r.results.filter((x) => !x.inChange) : [];
}

/** Caught out of scored (caught + survived); invalid mutants say nothing and are left out. */
export function score(results: MutationResult[]): { caught: number; scored: number; invalid: number } {
  const caught = results.filter((x) => x.outcome === "caught").length;
  const survived = results.filter((x) => x.outcome === "survived").length;
  return { caught, scored: caught + survived, invalid: results.length - caught - survived };
}

/**
 * Terraform reports an unmet `expect_failures` as an errored run (not a failed one) with this
 * diagnostic — it means the negative test noticed the mutant, so it counts as caught.
 */
const MISSING_EXPECTED_FAILURE = "Missing expected failure";

/** Score a test run on a mutant (see `MutationOutcome`). */
export function classifyMutationRun(initOk: boolean, report: TestReport): MutationOutcome {
  if (!initOk) return "invalid";
  // Checked before the summary: Terraform 1.16.6 can crash while *rendering* a failed
  // assertion (marked values, e.g. diagnostic-setting `enabled_log`), after it has already
  // reported the run as failed. The assertion noticed the bug; only the summary is lost.
  if (report.runs.some((r) => r.status === "fail")) return "caught";
  if (!report.summary) return "invalid";
  if (reportIsPass(report)) return "survived";
  return report.diagnostics.some((d) => d.includes(MISSING_EXPECTED_FAILURE)) ? "caught" : "invalid";
}
