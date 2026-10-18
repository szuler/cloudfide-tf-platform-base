// Pure logic: merge the agents' report with the authoritative test results, and check that
// the agent run actually did its job — so a silently blocked agent can never render as a
// green "nothing to do" comment.
import type { AgentReport, ChangedTarget, ModuleTestResult, Report } from "./types.ts";

/**
 * Count blocked tool calls in a Claude Code execution file (the action's `execution_file`
 * output). The file is a JSON array of SDK messages; the final `result` message carries
 * `permission_denials`. Unknown shapes count as 0 — this is a signal, not a gate.
 */
export function countPermissionDenials(execution: unknown): number {
  const messages = Array.isArray(execution) ? execution : [execution];
  let total = 0;
  for (const m of messages) {
    if (m && typeof m === "object" && (m as { type?: unknown }).type === "result") {
      const denials = (m as { permission_denials?: unknown }).permission_denials;
      if (Array.isArray(denials)) total += denials.length;
    }
  }
  return total;
}

export interface MergeInput {
  /** Parsed agent report, or null when the agent did not write one. */
  agent: AgentReport | null;
  results: ModuleTestResult[];
  /** Changed modules/stacks the agent was asked to handle (from detect-changed-modules). */
  targets: Pick<ChangedTarget, "dir" | "isNew">[];
  /** Blocked tool calls per agent pass, e.g. { author: 2, critic: 0 }. */
  denials: Record<string, number>;
}

export function mergeReport({ agent, results, targets, denials }: MergeInput): Report {
  const problems: string[] = [];
  const warnings: string[] = [];

  if (agent === null) {
    problems.push("The agent did not produce a report — its decisions and findings are unknown.");
  } else {
    const decided = new Set((agent.decisions ?? []).map((d) => d.target));
    for (const t of targets) {
      if (!decided.has(t.dir)) problems.push(`No decision recorded for \`${t.dir}\`.`);
    }
  }

  // New-vs-existing is a git fact, so it overrides whatever the agent inferred.
  const isNew = new Map(targets.map((t) => [t.dir, t.isNew]));
  const decisions = (agent?.decisions ?? []).map((d) => {
    const known = isNew.get(d.target);
    return known === undefined ? d : { ...d, targetIsNew: known };
  });

  for (const [pass, n] of Object.entries(denials)) {
    if (n > 0) warnings.push(`${pass} pass: ${n} tool call(s) were blocked by permissions — see the run log.`);
  }

  const report: Report = {
    decisions,
    findings: agent?.findings ?? [],
    results,
    testReview: agent?.testReview, // undefined if the critic did not run
  };
  if (problems.length > 0) report.problems = problems;
  if (warnings.length > 0) report.warnings = warnings;
  return report;
}
