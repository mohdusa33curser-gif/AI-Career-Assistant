import { mapAnalyzeSkillsToAnalysisResponse } from "@/api/mapAnalyzeSkillsResponse";
import type {
  AnalysisResponse,
  AnalyzeCVApiResponse,
  AnalyzeSkillsApiResponse,
} from "@/types/api";

export function mapAnalyzeCvToAnalysisResponse(
  api: AnalyzeCVApiResponse,
): AnalysisResponse {
  const inner: AnalyzeSkillsApiResponse = {
    skills: api.skills,
    top_jobs: api.top_jobs,
    gaps: api.gaps,
    recommendations: api.recommendations,
    career_score: api.career_score,
    career_path: api.career_path,
    next_role: api.next_role,
    learning_roadmap: api.learning_roadmap,
    insight_summary: api.insight_summary,
    extracted_skills: api.extracted_skills,
  };

  const base = mapAnalyzeSkillsToAnalysisResponse(inner);

  return {
    ...base,
    extractedSkills: [...api.extracted_skills],
    analysisMessage: api.message ?? null,
    inferredRole:
      api.message && api.extracted_skills.length === 0
        ? "No technical skills detected"
        : base.inferredRole,
  };
}