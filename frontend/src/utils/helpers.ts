import type { AnalysisResponse } from "@/types/api";

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

export function formatPercent(value: number): string {
  return `${clampPercent(value)}%`;
}

const STORAGE_KEY = "career_analysis_v1";

export function persistAnalysis(data: AnalysisResponse): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function readStoredAnalysis(): AnalysisResponse | null {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<AnalysisResponse>;
    const submitted = parsed.submittedSkills ?? {};
    return {
      readinessScore: parsed.readinessScore ?? 0,
      inferredRole: parsed.inferredRole ?? "",
      topMatches: parsed.topMatches ?? [],
      careerPaths: parsed.careerPaths ?? [],
      recommendations: parsed.recommendations ?? [],
      gaps: parsed.gaps ?? [],
      submittedSkills: submitted,
      extractedSkills:
        parsed.extractedSkills ?? (Object.keys(submitted).length ? Object.keys(submitted).sort() : []),
      analysisMessage: parsed.analysisMessage ?? null,
    };
  } catch {
    sessionStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function clearStoredAnalysis(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}
