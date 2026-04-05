import { Navigate, useLocation } from "react-router-dom";
import type { AnalysisResponse } from "@/types/api";
import { readStoredAnalysis } from "@/utils/helpers";
import { ResultsSection } from "@/components/ResultsSection";

export function Results() {
  const location = useLocation();
  const state = location.state as { analysis?: AnalysisResponse } | undefined;
  const analysis = state?.analysis ?? readStoredAnalysis();

  if (!analysis) {
    return <Navigate to="/" replace />;
  }

  return <ResultsSection analysis={analysis} />;
}
