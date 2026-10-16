// Shared types for the deterministic Terraform test-agent tooling.

export type TargetKind = "module" | "stack";

/** A changed module or stack, with the Terraform files that changed under it. */
export interface ChangedTarget {
  kind: TargetKind;
  name: string;
  dir: string;
  files: string[];
}

export interface DetectResult {
  targets: ChangedTarget[];
  /** Changed files that are not Terraform files under modules/ or stacks/. */
  ignored: string[];
}

export interface RunResult {
  file: string;
  run: string;
  status: string;
}

export interface TestSummary {
  status: string;
  passed: number;
  failed: number;
  errored: number;
  skipped: number;
}

export interface TestReport {
  summary: TestSummary | null;
  runs: RunResult[];
  diagnostics: string[];
  /** Count of output lines that were not valid JSON (robustness signal). */
  parseErrors: number;
}

export type StepStatus = "ok" | "failed" | "skipped";

export interface ModuleTestResult {
  dir: string;
  fmt: StepStatus;
  init: StepStatus;
  validate: StepStatus;
  test: TestReport | null;
  ok: boolean;
}

export type Severity = "info" | "low" | "medium" | "high";
export type Confidence = "fact" | "likely" | "hypothesis";

/** A reviewer-facing finding produced by the agent. Facts vs hypotheses are explicit. */
export interface Finding {
  file: string;
  line?: number;
  severity: Severity;
  confidence: Confidence;
  title: string;
  detail: string;
  suggestion?: string;
}

export interface AgentDecision {
  target: string;
  action: "created" | "updated" | "skipped";
  reason: string;
  skillsUsed?: string[];
}

/** The full report the workflow renders into a PR comment and job summary. */
export interface Report {
  decisions: AgentDecision[];
  results: ModuleTestResult[];
  findings: Finding[];
  /** When set, the agent did not run; everything else is ignored and this reason is shown. */
  notRun?: string;
}
