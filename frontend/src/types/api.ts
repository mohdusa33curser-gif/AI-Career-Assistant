export type SkillImportance = "High" | "Moderate" | "Low";

export type SkillMatchStatus = "matched" | "missing" | "partial";

export interface Skill {
  name: string;
  importance: SkillImportance;
  status: SkillMatchStatus;
}

export interface JobMatch {
  id: string;
  title: string;
  category: string;
  matchPercent: number;
  skills: Skill[];
  missingSkills: string[];
}

export interface Gap {
  skill: string;
  importance: SkillImportance;
}

export interface Recommendation {
  title: string;
  description: string;
  priority: number;
}

export interface CareerPath {
  id: string;
  name: string;
  requiredSkills: string[];
  missingSkills: string[];
  steps: string[];
}

/** Normalized view consumed by Results (mapped from API). */
export interface AnalysisResponse {
  readinessScore: number;
  inferredRole: string;
  topMatches: JobMatch[];
  careerPaths: CareerPath[];
  recommendations: Recommendation[];
  gaps: Gap[];
  /** Raw skill → weight echoed by the backend. */
  submittedSkills?: Record<string, number>;
  /** Skills detected in the CV (analyze-cv) or submitted (analyze-skills). */
  extractedSkills: string[];
  /** Server message when no CV skills matched the dataset vocabulary. */
  analysisMessage?: string | null;
}

/** POST /analyze-skills response (FastAPI). */
export interface AnalyzeSkillsGapRow {
  skill: string;
  status: string;
  job_weight: number;
  user_weight: number;
}

export interface AnalyzeSkillsGapSkillRow {
  skill: string;
  job_weight: number;
  user_weight: number;
}

export interface AnalyzeSkillsTopJob {
  job_title: string;
  category: string;
  match_percent: number;
  parsed_skills: Record<string, number>;
  gap_analysis: {
    strong: AnalyzeSkillsGapSkillRow[];
    partial: AnalyzeSkillsGapSkillRow[];
    missing: AnalyzeSkillsGapSkillRow[];
  };
  source_row_index: number;
  final_skill_count: number | null;
}

export interface AnalyzeSkillsRecommendation {
  title: string;
  description: string;
  priority: number;
}

export interface AnalyzeSkillsApiResponse {
  skills: Record<string, number>;
  top_jobs: AnalyzeSkillsTopJob[];
  gaps: AnalyzeSkillsGapRow[];
  recommendations: AnalyzeSkillsRecommendation[];
  career_score: number;
}

/** POST /analyze-cv response. */
export interface AnalyzeCVApiResponse {
  extracted_skills: string[];
  skills: Record<string, number>;
  top_jobs: AnalyzeSkillsTopJob[];
  gaps: AnalyzeSkillsGapRow[];
  recommendations: AnalyzeSkillsRecommendation[];
  career_score: number;
  message: string | null;
}
