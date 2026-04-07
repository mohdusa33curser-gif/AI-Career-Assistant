import type {
  AnalysisResponse,
  AnalyzeSkillsApiResponse,
  AnalyzeSkillsGapRow,
  AnalyzeSkillsGapSkillRow,
  AnalyzeSkillsTopJob,
  CareerPath,
  CareerPathSummary,
  Gap,
  InsightSummary,
  JobMatch,
  JobScoreBreakdown,
  LearningRoadmapItem,
  NextRoleInsight,
  Recommendation,
  Skill,
  SkillImportance,
} from "@/types/api";

function weightToImportance(w: number): SkillImportance {
  if (w >= 3) return "High";
  if (w >= 2) return "Moderate";
  return "Low";
}

function gapRowToSkill(
  row: AnalyzeSkillsGapSkillRow,
  status: Skill["status"],
): Skill {
  return {
    name: row.skill,
    importance: weightToImportance(row.job_weight),
    status,
  };
}

function mapScoreBreakdown(job: AnalyzeSkillsTopJob): JobScoreBreakdown {
  return {
    semanticMatchPercent: Number(job.score_breakdown?.semantic_match_percent ?? 0),
    weightedSkillPercent: Number(job.score_breakdown?.weighted_skill_percent ?? 0),
    exactOverlapPercent: Number(job.score_breakdown?.exact_overlap_percent ?? 0),
    categoryAlignmentPercent: Number(job.score_breakdown?.category_alignment_percent ?? 0),
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
    matchPercent: Number(job.match_percent),
    skills,
    missingSkills,
    whyThisRole: Array.isArray(job.why_this_role) ? job.why_this_role : [],
    scoreBreakdown: mapScoreBreakdown(job),
  };
}

function mapGaps(apiGaps: AnalyzeSkillsApiResponse["gaps"]): Gap[] {
  return apiGaps.map((g: AnalyzeSkillsGapRow) => ({
    skill: g.skill,
    importance: weightToImportance(g.job_weight),
    status: g.status,
    jobWeight: g.job_weight,
    userWeight: g.user_weight,
  }));
}

function mapRecommendations(
  rows: AnalyzeSkillsApiResponse["recommendations"],
): Recommendation[] {
  return [...rows]
    .sort((a, b) => a.priority - b.priority)
    .map((r) => ({
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
        "Ship evidence through projects, internships, or measurable outcomes",
      ],
    });

    i += 1;
  }

  return paths;
}

function mapCareerPathSummary(
  raw: AnalyzeSkillsApiResponse["career_path"] | undefined | null,
): CareerPathSummary | null {
  if (!raw) return null;

  return {
    primaryPath: raw.primary_path,
    secondaryPath: raw.secondary_path ?? null,
    confidencePercent: Number(raw.confidence_percent ?? 0),
    summary: raw.summary ?? "",
  };
}

function mapNextRole(
  raw: AnalyzeSkillsApiResponse["next_role"] | undefined | null,
): NextRoleInsight | null {
  if (!raw) return null;

  return {
    currentBestFit: raw.current_best_fit,
    stretchRole: raw.stretch_role ?? null,
    summary: raw.summary ?? "",
  };
}

function mapLearningRoadmap(
  raw: AnalyzeSkillsApiResponse["learning_roadmap"] | undefined,
): LearningRoadmapItem[] {
  if (!raw || !Array.isArray(raw)) return [];

  return raw.map((item) => ({
    skill: item.skill,
    priority: item.priority,
    reason: item.reason,
    estimatedImpact: item.estimated_impact,
  }));
}

function mapInsightSummary(
  raw: AnalyzeSkillsApiResponse["insight_summary"] | undefined | null,
): InsightSummary | null {
  if (!raw) return null;

  return {
    readinessBand: raw.readiness_band,
    strongestCategory: raw.strongest_category,
    bestMatchTitle: raw.best_match_title,
    bestMatchPercent: Number(raw.best_match_percent ?? 0),
    mainGap: raw.main_gap ?? null,
  };
}

function buildExtractedSkills(api: AnalyzeSkillsApiResponse): string[] {
  if (Array.isArray(api.extracted_skills) && api.extracted_skills.length > 0) {
    return [...new Set(api.extracted_skills)];
  }

  return Object.keys(api.skills).sort((a, b) => a.localeCompare(b));
}

export function mapAnalyzeSkillsToAnalysisResponse(
  api: AnalyzeSkillsApiResponse,
): AnalysisResponse {
  const topMatches = api.top_jobs.map((j, idx) => mapTopJob(j, idx));
  const first = topMatches[0];

  const insightSummary = mapInsightSummary(api.insight_summary);
  const inferredRole = first
    ? `${first.category} — ${first.title}`
    : "No close role match yet";

  return {
    readinessScore: Number(api.career_score),
    readinessBand: insightSummary?.readinessBand,
    inferredRole,
    topMatches,
    careerPaths: buildCareerPaths(topMatches),
    recommendations: mapRecommendations(api.recommendations),
    gaps: mapGaps(api.gaps),
    submittedSkills: { ...api.skills },
    extractedSkills: buildExtractedSkills(api),
    analysisMessage: null,
    careerPath: mapCareerPathSummary(api.career_path),
    nextRole: mapNextRole(api.next_role),
    learningRoadmap: mapLearningRoadmap(api.learning_roadmap),
    insightSummary,
  };
}