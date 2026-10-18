// Pure logic: render the single sticky PR comment (and job summary) markdown.
import type {
  AgentDecision,
  Finding,
  ModuleTestResult,
  MutationReport,
  Report,
  Severity,
  TestReviewVote,
} from "./types.ts";

/** Hidden marker so the workflow can find-and-update one comment instead of spamming. */
export const COMMENT_MARKER = "<!-- tf-test-agent -->";

const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2, info: 3 };

/** `action` describes the test file, not the module — say so, so "created" isn't read as "new module". */
const ACTION_LABEL: Record<AgentDecision["action"], string> = {
  created: "tests created",
  updated: "tests updated",
  skipped: "skipped",
};

function statusIcon(ok: boolean): string {
  return ok ? "✅" : "❌";
}

function renderTestRow(r: ModuleTestResult): string {
  const t = r.test;
  let detail: string;
  if (!t) {
    detail = "no tests";
  } else if (t.summary) {
    detail = `${t.summary.passed} passed, ${t.summary.failed} failed, ${t.summary.errored} errored`;
  } else {
    detail = "no result parsed";
  }
  return `| \`${r.dir}\` | ${statusIcon(r.ok)} | ${detail} |`;
}

function renderTestReview(votes: TestReviewVote[]): string {
  if (votes.length === 0) return "_All assertions passed independent review._";
  const icons: Record<string, string> = { keep: "✅", strengthen: "🔧", drop: "🗑️" };
  return votes
    .map((v) => {
      const icon = icons[v.verdict] ?? "?";
      const applied = v.applied ? " _(applied)_" : "";
      return `- ${icon} **${v.verdict}** \`${v.run}\` in \`${v.file}\` — ${v.reason}${applied}`;
    })
    .join("\n");
}

function renderMutations(reports: MutationReport[]): string {
  const out = [
    "_Each mutation plants one small bug in a copy of the module; a good suite fails on it. " +
      "A survivor is a signal for the reviewer, not a defect — some bugs cannot be seen at plan " +
      "level with a mocked provider._",
    "",
  ];
  for (const r of reports) {
    if (r.note) {
      out.push(`- \`${r.dir}\`: ${r.note}`);
      continue;
    }
    const caught = r.results.filter((x) => x.outcome === "caught").length;
    const survived = r.results.filter((x) => x.outcome === "survived");
    const invalid = r.results.filter((x) => x.outcome === "invalid").length;
    const ignored = invalid ? `, ${invalid} invalid mutant(s) ignored` : "";
    out.push(`- \`${r.dir}\`: ${caught}/${caught + survived.length} caught${ignored}`);
    for (const s of survived) out.push(`  - ⚠️ survived \`${s.name}\` (\`${s.file}\`) — ${s.hint}`);
  }
  return out.join("\n");
}

function renderFindings(findings: Finding[]): string {
  if (findings.length === 0) return "_No findings._";
  const sorted = [...findings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const out: string[] = [];
  for (const f of sorted) {
    const loc = f.line ? `${f.file}:${f.line}` : f.file;
    out.push(`- **[${f.severity} / ${f.confidence}]** ${f.title} — \`${loc}\``);
    out.push(`  - ${f.detail}`);
    if (f.suggestion) out.push(`  - _Suggested direction:_ ${f.suggestion}`);
  }
  return out.join("\n");
}

export function renderComment(report: Report): string {
  return [COMMENT_MARKER, "## 🧪 Terraform Test Agent", "", renderReportBody(report)].join("\n");
}

/** The report sections without the marker and title, so the per-run comment can add its own. */
export function renderReportBody(report: Report): string {
  const parts: string[] = [];

  if (report.notRun) {
    parts.push(`> ⚠️ **Agent did not run:** ${report.notRun}`, "");
    return parts.join("\n");
  }

  if (report.problems?.length) {
    parts.push("> ❌ **Agent run incomplete — do not read the sections below as a pass:**");
    for (const p of report.problems) parts.push(`> - ${p}`);
    parts.push("");
  }
  if (report.warnings?.length) {
    parts.push("> ⚠️ **Warnings:**");
    for (const w of report.warnings) parts.push(`> - ${w}`);
    parts.push("");
  }

  parts.push("### Decisions", "");
  if (report.decisions.length === 0) {
    const empty = report.problems?.length ? "_No decisions recorded._" : "_No Terraform changes required test updates._";
    parts.push(empty, "");
  } else {
    for (const d of report.decisions) {
      const skills = d.skillsUsed?.length ? ` _(skills: ${d.skillsUsed.join(", ")})_` : "";
      const kind = d.targetIsNew === undefined ? "" : d.targetIsNew ? " _(new in this PR)_" : " _(existing)_";
      parts.push(`- **${d.target}**${kind} — ${ACTION_LABEL[d.action]}: ${d.reason}${skills}`);
    }
    parts.push("");
  }

  parts.push("### Test results", "", "| Target | Status | Detail |", "| --- | --- | --- |");
  for (const r of report.results) parts.push(renderTestRow(r));
  parts.push("");

  if (report.testReview !== undefined) {
    parts.push("### Independent test review", "", renderTestReview(report.testReview), "");
  }

  if (report.mutations?.length) {
    parts.push("### Mutation check (informational)", "", renderMutations(report.mutations), "");
  }

  parts.push("### Findings for the reviewer", "", renderFindings(report.findings), "");

  parts.push("---", "_Infrastructure code is never modified by the agent. Decisions stay with people._");
  return parts.join("\n");
}

/** Job summary is the same content without the HTML comment marker. */
export function renderJobSummary(report: Report): string {
  return renderComment(report).replace(`${COMMENT_MARKER}\n`, "");
}
