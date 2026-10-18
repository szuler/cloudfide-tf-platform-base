// Pure logic: the summary of an audit of an existing test suite. The agent proposes test changes
// (never committed); the workflow measures them deterministically — mutation score on the suite
// before vs after the proposals — so a person can judge the patch on evidence, not on the
// agent's say-so.
import { score } from "./mutate.ts";
import type { MutationReport, MutationResult } from "./types.ts";

export interface PatchStat {
  files: number;
  added: number;
  removed: number;
}

/** Parse `git diff --numstat` (binary files show "-" and count as 0 lines). */
export function parseNumstat(numstat: string): PatchStat {
  const stat: PatchStat = { files: 0, added: 0, removed: 0 };
  for (const line of numstat.split(/\r?\n/)) {
    const [a, r, path] = line.trim().split("\t");
    if (!path) continue;
    stat.files++;
    stat.added += Number(a) || 0;
    stat.removed += Number(r) || 0;
  }
  return stat;
}

export interface AuditInput {
  module: string;
  before: MutationReport | null;
  after: MutationReport | null;
  patch: PatchStat;
  testsOk: boolean;
}

const scoreText = (r: MutationReport | null) => {
  if (!r || r.note || r.results.length === 0) return r?.note ?? "not run";
  const s = score(r.results);
  return `${s.caught}/${s.scored} caught${s.invalid ? `, ${s.invalid} invalid` : ""}`;
};

const survivors = (r: MutationReport | null): MutationResult[] =>
  r ? r.results.filter((x) => x.outcome === "survived") : [];

/** Survivors before that the proposed suite catches, and survivors that remain. */
export function compareMutations(before: MutationReport | null, after: MutationReport | null) {
  const afterOutcome = new Map((after?.results ?? []).map((x) => [x.name, x.outcome]));
  const was = survivors(before);
  return {
    closed: was.filter((x) => afterOutcome.get(x.name) === "caught"),
    remaining: survivors(after),
    // A mutant the original suite caught but the proposals let through: the suite got weaker.
    regressed: (before?.results ?? []).filter((x) => x.outcome === "caught" && afterOutcome.get(x.name) === "survived"),
  };
}

export function renderAudit(a: AuditInput): string {
  const { closed, remaining, regressed } = compareMutations(a.before, a.after);
  const lines = [
    `## 🔎 Test suite audit — \`${a.module}\``,
    "",
    "_The agent's proposals are **not committed**. They're in `proposal.patch` in the run's " +
      "`tf-test-audit` artifact. Apply with `git apply proposal.patch` on a branch and open a PR " +
      "if you agree._",
    "",
    "| | Mutations |",
    "| --- | --- |",
    `| Existing suite | ${scoreText(a.before)} |`,
    `| With the proposals | ${scoreText(a.after)} |`,
    "",
  ];
  if (a.patch.files === 0) {
    lines.push("**No test changes proposed.**", "");
  } else {
    const verdict = a.testsOk ? "✅ the proposed suite passes" : "❌ the proposed suite does **not** pass";
    lines.push(
      `**Proposal:** ${a.patch.files} file(s), +${a.patch.added} / −${a.patch.removed} lines — ${verdict}.`,
      "",
    );
  }
  for (const m of closed) lines.push(`- ✅ now caught: \`${m.name}\` (\`${m.file}${m.line ? `:${m.line}` : ""}\`) — was: ${m.hint}`);
  for (const m of regressed) lines.push(`- ❌ caught before, survives now: \`${m.name}\` — the proposals weakened the suite`);
  for (const m of remaining) lines.push(`- ⚠️ still survives: \`${m.name}\` (\`${m.file}${m.line ? `:${m.line}` : ""}\`) — ${m.hint}`);
  return lines.join("\n");
}
