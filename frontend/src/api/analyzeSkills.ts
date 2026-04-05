import { apiClient } from "@/api/client";
import type { AnalyzeSkillsApiResponse } from "@/types/api";

export interface AnalyzeSkillsRequestBody {
  skills: string[];
}

export async function postAnalyzeSkills(skills: string[]): Promise<AnalyzeSkillsApiResponse> {
  const { data } = await apiClient.post<AnalyzeSkillsApiResponse>("/analyze-skills", {
    skills,
  } satisfies AnalyzeSkillsRequestBody);
  return data;
}
