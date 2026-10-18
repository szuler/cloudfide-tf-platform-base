// Shared types for the deterministic Terraform test-agent tooling.

export type TargetKind = "module" | "stack";

/** A changed module or stack, with the Terraform files that changed under it. */
export interface ChangedTarget {
  kind: TargetKind;
  name: string;
  dir: string;
  files: string[];
  /** True when the dir did not exist at the PR's base commit. Set from git, never by the agent. */
  isNew?: boolean;
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
export type CriticVerdict = "keep" | "strengthen" | "drop";

export interface TestReviewVote {
  file: string;
  run: string;
  verdict: CriticVerdict;
  reason: string;
  applied?: boolean;
}

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
  /** Whether the target is new in this PR — filled in by the workflow from git, not the agent. */
  targetIsNew?: boolean;
  /** Set when git contradicted the agent: what it reported, before `action` was corrected. */
  reportedAction?: "created" | "updated" | "skipped";
}

/**
 * - caught:   a test run failed — an assertion (or an unmet expect_failures) noticed the bug.
 * - survived: the suite still passes — a coverage gap.
 * - invalid:  init failed, Terraform crashed, or runs only errored — the mutant itself is
 *             broken, so it says nothing about the tests and must not count as caught.
 */
export type MutationOutcome = "caught" | "survived" | "invalid";

export interface MutationResult {
  name: string;
  file: string;
  outcome: MutationOutcome;
  hint: string;
  /** 1-based line of the mutated occurrence. */
  line?: number;
  /** Whether the mutated line is one the PR changed. */
  inChange?: boolean;
}

/**
 * What the headline numbers judge, from git facts:
 * - suite-created: the module had no tests at the PR's base, so the whole suite is new in this
 *   PR and every mutant judges it.
 * - change: the suite existed; the headline is mutants on lines the PR changed, the rest
 *   judges pre-existing tests.
 * - module: no base to compare with (local run); every mutant counts.
 */
export type MutationScope = "suite-created" | "change" | "module";

/** Mutation check of one module's test suite. Informational: never fails the job. */
export interface MutationReport {
  dir: string;
  scope?: MutationScope;
  results: MutationResult[];
  /** Set when nothing was checked (no tests, no applicable mutation). */
  note?: string;
}

/** The full report the workflow renders into a PR comment and job summary. */
export interface Report {
  decisions: AgentDecision[];
  results: ModuleTestResult[];
  findings: Finding[];
  /** Verdicts from the independent critic pass (tf-review-tests). */
  testReview?: TestReviewVote[];
  /** When set, the agent did not run; everything else is ignored and this reason is shown. */
  notRun?: string;
  /** Deterministic checks the agent run failed (missing report/decisions). Fails the job. */
  problems?: string[];
  /** Non-blocking signals worth a reviewer's attention (e.g. blocked tool calls). */
  warnings?: string[];
  /** Mutation check of the final test suites (deterministic, informational). */
  mutations?: MutationReport[];
}

/** A test file the agent's commit touched — read from git, not from the agent's report. */
export interface TestFileChange {
  path: string;
  status: "created" | "updated" | "deleted";
  runsAdded: number;
  runsRemoved: number;
}

/** One agent run in the PR ledger. */
export interface LedgerRow {
  /** "run": recorded by that run. "history": rebuilt from git / the pre-ledger comment. */
  source: "run" | "history";
  /** An earlier attempt of a re-run workflow run that changed tests (kept, not replaced). */
  earlierAttempt?: boolean;
  runId?: string;
  runUrl?: string;
  /** The PR head the run evaluated. */
  headSha?: string;
  /** The test commit the agent pushed, if any. */
  agentCommit?: string;
  status?: "ok" | "failed" | "not-run";
  tests?: { passed: number; total: number };
  mutation?: { caught: number; scored: number };
  changes: TestFileChange[];
  /** Which pass changed each test file in this run (paths), from snapshots between passes. */
  changedBy?: { author: string[]; critic: string[] };
  decisions?: Array<Pick<AgentDecision, "target" | "action" | "reason" | "reportedAction">>;
  review?: Record<CriticVerdict, number>;
  findings?: number;
  problems?: string[];
  /** Body of the pre-ledger comment, kept verbatim when it is adopted as the ledger. */
  legacyBody?: string;
}

export interface Ledger {
  rows: LedgerRow[];
}

/** An existing PR comment written by the workflow (already filtered to the bot's own). */
export interface PrComment {
  id: number;
  node_id: string;
  html_url: string;
  body: string;
}

/** An agent commit found in the PR's history. */
export interface AgentCommit {
  sha: string;
  parent?: string;
  changes: TestFileChange[];
}

/** What the agent passes write to the report file, before the workflow merges test results in. */
export interface AgentReport {
  decisions?: AgentDecision[];
  findings?: Finding[];
  testReview?: TestReviewVote[];
}
