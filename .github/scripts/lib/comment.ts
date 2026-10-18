// Pure logic: render the single sticky PR comment (and job summary) markdown.
import type { Finding, ModuleTestResult, Report, Severity, TestReviewVote } from "./types.ts";

/** Hidden marker so the workflow can find-and-update one comment instead of spamming. */
export const COMMENT_MARKER = "<!-- tf-test-agent -->";

const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2, info: 3 };

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
  const parts: string[] = [COMMENT_MARKER, "## 🧪 Terraform Test Agent", ""];

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
      parts.push(`- **${d.target}** — ${d.action}: ${d.reason}${skills}`);
    }
    parts.push("");
  }

  parts.push("### Test results", "", "| Target | Status | Detail |", "| --- | --- | --- |");
  for (const r of report.results) parts.push(renderTestRow(r));
  parts.push("");

  if (report.testReview !== undefined) {
    parts.push("### Independent test review", "", renderTestReview(report.testReview), "");
  }

  parts.push("### Findings for the reviewer", "", renderFindings(report.findings), "");

  parts.push("---", "_Infrastructure code is never modified by the agent. Decisions stay with people._");
  return parts.join("\n");
}

/** Job summary is the same content without the HTML comment marker. */
export function renderJobSummary(report: Report): string {
  return renderComment(report).replace(`${COMMENT_MARKER}\n`, "");
}
