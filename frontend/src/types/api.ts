export type SkillImportance = "High" | "Moderate" | "Low";
export type SkillMatchStatus = "matched" | "missing" | "partial";

export interface Skill {
  name: string;
  importance: SkillImportance;
  status: SkillMatchStatus;
}

export interface JobScoreBreakdown {
  semanticMatchPercent: number;
  weightedSkillPercent: number;
  exactOverlapPercent: number;
  categoryAlignmentPercent: number;
}

export interface JobMatch {
  id: string;
  title: string;
  category: string;
  matchPercent: number;
  skills: Skill[];
  missingSkills: string[];
  whyThisRole: string[];
  scoreBreakdown: JobScoreBreakdown;
}

export interface Gap {
  skill: string;
  importance: SkillImportance;
  status?: string;
  jobWeight?: number;
  userWeight?: number;
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

export interface CareerPathSummary {
  primaryPath: string;
  secondaryPath: string | null;
  confidencePercent: number;
  summary: string;
}

export interface NextRoleInsight {
  currentBestFit: string;
  stretchRole: string | null;
  summary: string;
}

export interface LearningRoadmapItem {
  skill: string;
  priority: string;
  reason: string;
  estimatedImpact: string;
}

export interface InsightSummary {
  readinessBand: string;
  strongestCategory: string;
  bestMatchTitle: string;
  bestMatchPercent: number;
  mainGap: string | null;
}

/** Normalized view consumed by Results. */
export interface AnalysisResponse {
  readinessScore: number;
  readinessBand?: string;
  inferredRole: string;
  topMatches: JobMatch[];
  careerPaths: CareerPath[];
  recommendations: Recommendation[];
  gaps: Gap[];
  submittedSkills?: Record<string, number>;
  extractedSkills: string[];
  analysisMessage?: string | null;

  careerPath?: CareerPathSummary | null;
  nextRole?: NextRoleInsight | null;
  learningRoadmap: LearningRoadmapItem[];
  insightSummary?: InsightSummary | null;
}

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

  why_this_role?: string[];
  score_breakdown?: {
    semantic_match_percent?: number;
    weighted_skill_percent?: number;
    exact_overlap_percent?: number;
    category_alignment_percent?: number;
  };
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

  career_path?: {
    primary_path: string;
    secondary_path: string | null;
    confidence_percent: number;
    summary: string;
  } | null;

  next_role?: {
    current_best_fit: string;
    stretch_role: string | null;
    summary: string;
  } | null;

  learning_roadmap?: Array<{
    skill: string;
    priority: string;
    reason: string;
    estimated_impact: string;
  }>;

  insight_summary?: {
    readiness_band: string;
    strongest_category: string;
    best_match_title: string;
    best_match_percent: number;
    main_gap: string | null;
  } | null;

  extracted_skills?: string[];
}

export interface AnalyzeCVApiResponse {
  extracted_skills: string[];
  skills: Record<string, number>;
  top_jobs: AnalyzeSkillsTopJob[];
  gaps: AnalyzeSkillsGapRow[];
  recommendations: AnalyzeSkillsRecommendation[];
  career_score: number;
  message: string | null;

  career_path?: AnalyzeSkillsApiResponse["career_path"];
  next_role?: AnalyzeSkillsApiResponse["next_role"];
  learning_roadmap?: AnalyzeSkillsApiResponse["learning_roadmap"];
  insight_summary?: AnalyzeSkillsApiResponse["insight_summary"];
}
