// Pure logic: one metrics record per run — cost, performance and quality signals — built only
// from data the run already produces (the passes' execution files and the merged report), so
// runs can be compared and trended without an external service. Informational, never a gate.
import { countPermissionDenials } from "./merge.ts";
import { headlineResults, score } from "./mutate.ts";
import type { Report, Severity } from "./types.ts";

export interface PassMetrics {
  costUsd: number;
  durationMs: number;
  apiDurationMs: number;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** e.g. "completed", "api_error", "max_turns" — as Claude Code reports it. */
  terminalReason?: string;
  isError: boolean;
  permissionDenials: number;
}

export interface RunMetrics {
  schema: 1;
  runUrl: string;
  headSha: string;
  pr: number;
  passes: { author?: PassMetrics; critic?: PassMetrics };
  cost: { totalUsd: number; cacheReadShare: number };
  performance: { agentDurationMs: number; agentTurns: number };
  quality: {
    testsPassed: number;
    testsTotal: number;
    /** The mutation check's headline score (see MutationScope), null if nothing was scored. */
    mutation: { caught: number; scored: number } | null;
    critic: { keep: number; strengthen: number; drop: number; applied: number } | null;
    /** Decisions whose test-change label git corrected (`reportedAction`). */
    labelCorrections: number;
    findingsBySeverity: Record<Severity, number>;
    findingsByConfidence: Record<string, number>;
    problems: number;
    warnings: number;
  };
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Metrics of one pass from its execution file (a JSON array of SDK messages); null if absent. */
export function passMetrics(execution: unknown): PassMetrics | null {
  const messages = Array.isArray(execution) ? execution : [execution];
  const result = messages.find(
    (m): m is Record<string, unknown> => !!m && typeof m === "object" && (m as { type?: unknown }).type === "result",
  );
  if (!result) return null;
  const usage = (result.usage ?? {}) as Record<string, unknown>;
  const out: PassMetrics = {
    costUsd: num(result.total_cost_usd),
    durationMs: num(result.duration_ms),
    apiDurationMs: num(result.duration_api_ms),
    turns: num(result.num_turns),
    inputTokens: num(usage.input_tokens),
    outputTokens: num(usage.output_tokens),
    cacheReadTokens: num(usage.cache_read_input_tokens),
    cacheCreationTokens: num(usage.cache_creation_input_tokens),
    isError: result.is_error === true,
    permissionDenials: countPermissionDenials(execution),
  };
  if (typeof result.terminal_reason === "string") out.terminalReason = result.terminal_reason;
  return out;
}

export interface MetricsContext {
  runUrl: string;
  headSha: string;
  pr: number;
}

export function buildMetrics(
  report: Report,
  passes: { author?: PassMetrics | null; critic?: PassMetrics | null },
  ctx: MetricsContext,
): RunMetrics {
  const present = [passes.author, passes.critic].filter((p): p is PassMetrics => !!p);
  const sum = (f: (p: PassMetrics) => number) => present.reduce((a, p) => a + f(p), 0);
  const inputSide = sum((p) => p.inputTokens + p.cacheReadTokens + p.cacheCreationTokens);

  let testsPassed = 0;
  let testsTotal = 0;
  for (const r of report.results) {
    const s = r.test?.summary;
    if (s) {
      testsPassed += s.passed;
      testsTotal += s.passed + s.failed + s.errored;
    }
  }

  const mutation = report.mutations?.length ? score(report.mutations.flatMap(headlineResults)) : null;
  const critic = report.testReview
    ? {
        keep: report.testReview.filter((v) => v.verdict === "keep").length,
        strengthen: report.testReview.filter((v) => v.verdict === "strengthen").length,
        drop: report.testReview.filter((v) => v.verdict === "drop").length,
        applied: report.testReview.filter((v) => v.applied).length,
      }
    : null;

  const findingsBySeverity: Record<Severity, number> = { high: 0, medium: 0, low: 0, info: 0 };
  const findingsByConfidence: Record<string, number> = {};
  for (const f of report.findings) {
    findingsBySeverity[f.severity] = (findingsBySeverity[f.severity] ?? 0) + 1;
    findingsByConfidence[f.confidence] = (findingsByConfidence[f.confidence] ?? 0) + 1;
  }

  const authorAndCritic: RunMetrics["passes"] = {};
  if (passes.author) authorAndCritic.author = passes.author;
  if (passes.critic) authorAndCritic.critic = passes.critic;

  return {
    schema: 1,
    ...ctx,
    passes: authorAndCritic,
    cost: {
      totalUsd: Math.round(sum((p) => p.costUsd) * 10_000) / 10_000,
      cacheReadShare: inputSide ? Math.round((sum((p) => p.cacheReadTokens) / inputSide) * 1000) / 1000 : 0,
    },
    performance: { agentDurationMs: sum((p) => p.durationMs), agentTurns: sum((p) => p.turns) },
    quality: {
      testsPassed,
      testsTotal,
      mutation: mutation && mutation.scored ? { caught: mutation.caught, scored: mutation.scored } : null,
      critic,
      labelCorrections: report.decisions.filter((d) => d.reportedAction).length,
      findingsBySeverity,
      findingsByConfidence,
      problems: report.problems?.length ?? 0,
      warnings: report.warnings?.length ?? 0,
    },
  };
}

const secs = (ms: number) => `${(ms / 1000).toFixed(0)} s`;

function passRow(name: string, p?: PassMetrics): string {
  if (!p) return `| ${name} | — | — | — | — | — | not run |`;
  const status = p.isError ? `❌ ${p.terminalReason ?? "error"}` : (p.terminalReason ?? "ok");
  const tokens = `${p.outputTokens} out / ${p.cacheReadTokens + p.cacheCreationTokens + p.inputTokens} in`;
  return `| ${name} | $${p.costUsd.toFixed(3)} | ${secs(p.durationMs)} | ${p.turns} | ${tokens} | ${p.permissionDenials} | ${status} |`;
}

/** Markdown for the job summary. */
export function renderMetrics(m: RunMetrics): string {
  const q = m.quality;
  const critic = q.critic ? `${q.critic.keep} keep · ${q.critic.strengthen} strengthen · ${q.critic.drop} drop (${q.critic.applied} applied)` : "—";
  const findings = (Object.entries(q.findingsBySeverity) as [Severity, number][])
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${n} ${s}`)
    .join(", ") || "none";
  return [
    "### Run metrics",
    "",
    "| Pass | Cost | Time | Turns | Tokens | Blocked calls | Result |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    passRow("author", m.passes.author),
    passRow("critic", m.passes.critic),
    "",
    `**Cost:** $${m.cost.totalUsd.toFixed(3)} · **cache-read share of input:** ${(m.cost.cacheReadShare * 100).toFixed(0)}% · **agent time:** ${secs(m.performance.agentDurationMs)} · **turns:** ${m.performance.agentTurns}`,
    "",
    `**Quality signals:** tests ${q.testsPassed}/${q.testsTotal} · mutations ${q.mutation ? `${q.mutation.caught}/${q.mutation.scored}` : "—"} · critic ${critic} · label corrections by git ${q.labelCorrections} · findings ${findings} · problems ${q.problems} · warnings ${q.warnings}`,
    "",
    "_The full record is `metrics.json` in the run's `tf-test-agent-report` artifact._",
  ].join("\n");
}
