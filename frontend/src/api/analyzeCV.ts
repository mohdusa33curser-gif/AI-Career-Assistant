import { apiClient } from "@/api/client";
import type { AnalyzeCVApiResponse } from "@/types/api";

export async function postAnalyzeCV(file: File): Promise<AnalyzeCVApiResponse> {
  const body = new FormData();
  body.append("file", file);
  const { data } = await apiClient.post<AnalyzeCVApiResponse>("/analyze-cv", body, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}
