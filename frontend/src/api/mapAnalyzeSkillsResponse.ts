import type {
  AnalysisResponse,
  AnalyzeSkillsApiResponse,
  AnalyzeSkillsGapSkillRow,
  AnalyzeSkillsTopJob,
  CareerPath,
  Gap,
  JobMatch,
  Recommendation,
  Skill,
  SkillImportance,
} from "@/types/api";

function weightToImportance(w: number): SkillImportance {
  if (w >= 3) {
    return "High";
  }
  if (w >= 2) {
    return "Moderate";
  }
  return "Low";
}

function gapRowToSkill(row: AnalyzeSkillsGapSkillRow, status: Skill["status"]): Skill {
  return {
    name: row.skill,
    importance: weightToImportance(row.job_weight),
    status,
  };
}

function mapTopJob(job: AnalyzeSkillsTopJob, index: number): JobMatch {
  const skills: Skill[] = [
    ...job.gap_analysis.strong.map((r) => gapRowToSkill(r, "matched")),
    ...job.gap_analysis.partial.map((r) => gapRowToSkill(r, "partial")),
    ...job.gap_analysis.missing.map((r) => gapRowToSkill(r, "missing")),
  ];
  const missingSkills = job.gap_analysis.missing.map((m) => m.skill);
  return {
    id: String(job.source_row_index ?? index),
    title: job.job_title,
    category: job.category,
    matchPercent: job.match_percent,
    skills,
    missingSkills,
  };
}

function mapGaps(apiGaps: AnalyzeSkillsApiResponse["gaps"]): Gap[] {
  return apiGaps.map((g) => ({
    skill: g.skill,
    importance: weightToImportance(g.job_weight),
  }));
}

function mapRecommendations(rows: AnalyzeSkillsApiResponse["recommendations"]): Recommendation[] {
  return rows.map((r) => ({
    title: r.title,
    description: r.description,
    priority: r.priority,
  }));
}

function buildCareerPaths(topMatches: JobMatch[]): CareerPath[] {
  const seen = new Map<string, JobMatch>();
  for (const j of topMatches) {
    const key = j.category || "General";
    if (!seen.has(key)) {
      seen.set(key, j);
    }
  }
  const paths: CareerPath[] = [];
  let i = 0;
  for (const [category, job] of seen) {
    const required = [...new Set(job.skills.map((s) => s.name))];
    const missing = [...new Set(job.missingSkills)];
    paths.push({
      id: `path-${i}`,
      name: category,
      requiredSkills: required,
      missingSkills: missing,
      steps: [
        `Align with "${job.title}" expectations`,
        missing.length
          ? `Close gaps: ${missing.slice(0, 4).join(", ")}${missing.length > 4 ? "…" : ""}`
          : "Reinforce strengths with measurable outcomes",
        "Ship evidence (projects, certs, or production impact)",
      ],
    });
    i += 1;
  }
  return paths;
}

export function mapAnalyzeSkillsToAnalysisResponse(
  api: AnalyzeSkillsApiResponse,
): AnalysisResponse {
  const topMatches = api.top_jobs.map((j, idx) => mapTopJob(j, idx));
  const first = topMatches[0];
  const inferredRole = first
    ? `${first.category} — ${first.title}`
    : "No close role match yet";

  return {
    readinessScore: api.career_score,
    inferredRole,
    topMatches,
    careerPaths: buildCareerPaths(topMatches),
    recommendations: mapRecommendations(api.recommendations),
    gaps: mapGaps(api.gaps),
    submittedSkills: { ...api.skills },
    extractedSkills: Object.keys(api.skills).sort(),
    analysisMessage: null,
  };
}
