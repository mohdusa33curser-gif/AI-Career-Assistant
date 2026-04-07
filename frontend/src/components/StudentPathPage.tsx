import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import StudentPathResults from "@/components/StudentPathResults";
import { mapAnalyzeCvToAnalysisResponse } from "@/api/mapAnalyzeCvResponse";
import type { AnalysisResponse, AnalyzeCVApiResponse } from "@/types/api";

const API_BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ||
  "http://127.0.0.1:8000";

const INFO_CARDS = [
  { label: "Primary output", value: "Recommended paths", hint: "Technical directions that match your current profile." },
  { label: "Secondary output", value: "Entry roles", hint: "Each path contains realistic roles you can grow into." },
  { label: "Main value", value: "Learning roadmap", hint: "The skills you should learn first for each path." },
  { label: "Best for", value: "Students", hint: "Ideal when you want direction before applying for jobs." },
];

const WHAT_APPEARS = [
  "Recommended paths sorted by fit",
  "The roles that belong to each path",
  "The skills you already have for that path",
  "The skills you should learn next",
];

export default function StudentPathPage() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);

  const selectedFileLabel = useMemo(() => file?.name ?? null, [file]);

  async function handleAnalyze() {
    if (!file || loading) return;
    setLoading(true);
    setErrorText(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch(`${API_BASE}/analyze-cv?top_k=10`, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        let message = "Failed to analyze CV.";
        try {
          const payload = await response.json();
          message = payload?.detail || message;
        } catch {
          // ignore
        }
        throw new Error(message);
      }
      const payload = (await response.json()) as AnalyzeCVApiResponse;
      const mapped = mapAnalyzeCvToAnalysisResponse(payload);
      setAnalysis(mapped);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Unexpected error.");
    } finally {
      setLoading(false);
    }
  }

  function resetAll() {
    setFile(null);
    setErrorText(null);
    setAnalysis(null);
  }

  if (analysis) {
    return (
      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold text-white">Path Explorer Results</h1>
            {selectedFileLabel && (
              <p className="mt-1 text-sm text-slate-400">
                Analyzed: <span className="text-slate-200">{selectedFileLabel}</span>
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={resetAll}
            className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10"
          >
            Analyze another CV
          </button>
        </div>
        <StudentPathResults analysis={analysis} />
      </div>
    );
  }

  return (
    <div className="grid gap-5 md:h-[calc(100vh-7rem)] xl:grid-cols-[420px_minmax(0,1fr)] xl:items-stretch">
      {/* LEFT: Upload */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.36 }}
        className="flex flex-col rounded-3xl border border-amber-500/25 bg-gradient-to-b from-amber-500/[0.07] to-white/[0.02] p-6 shadow-[0_18px_50px_rgba(0,0,0,0.18)] backdrop-blur-sm md:p-7"
      >
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-400">
            Student Path Explorer
          </p>
          <h1 className="mt-3 font-display text-2xl font-bold leading-tight text-white md:text-3xl">
            Explore the right path for your current profile
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            Upload your CV to discover which technical paths fit you best,
            what roles live inside each path, and what to learn next.
          </p>
        </div>

        <div className="mt-5 flex-1 rounded-2xl border border-dashed border-white/15 bg-black/10 p-5">
          <label className="block cursor-pointer">
            <input
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <div className="flex min-h-[140px] flex-col items-center justify-center rounded-xl border border-white/10 bg-white/[0.02] p-5 text-center transition hover:bg-white/[0.04]">
              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-amber-400">
                PDF only
              </span>
              <h2 className="mt-4 text-lg font-semibold text-white">Upload your CV</h2>
              <p className="mt-2 max-w-xs text-xs leading-5 text-slate-400">
                We'll analyze your strengths and detect possible career paths.
              </p>
            </div>
          </label>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300">
              {selectedFileLabel ? `Selected: ${selectedFileLabel}` : "No file selected"}
            </div>
            <button
              type="button"
              onClick={handleAnalyze}
              disabled={!file || loading}
              className="rounded-full bg-amber-500 px-5 py-2 text-sm font-semibold text-slate-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Analyzing..." : "Explore paths"}
            </button>
            {file && !loading && (
              <button
                type="button"
                onClick={resetAll}
                className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10"
              >
                Clear
              </button>
            )}
          </div>

          {errorText && (
            <div className="mt-4 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
              {errorText}
            </div>
          )}
        </div>
      </motion.div>

      {/* RIGHT: Info */}
      <motion.div
        initial={{ opacity: 0, x: 16 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.36, delay: 0.1 }}
        className="flex flex-col rounded-3xl border border-white/10 bg-white/[0.03] p-6 shadow-[0_18px_50px_rgba(0,0,0,0.18)] backdrop-blur-sm md:p-7"
      >
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent/80">
            How it works
          </p>
          <h2 className="mt-3 font-display text-2xl font-bold text-white">
            Choose a path before you choose a job
          </h2>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            Instead of ranking jobs first, we turn your CV into possible directions
            and show what to learn to move into each path.
          </p>
        </div>

        <div className="mt-5 grid flex-1 gap-3 md:grid-cols-2 content-start">
          {INFO_CARDS.map((card) => (
            <div key={card.label} className="rounded-2xl border border-white/10 bg-black/10 p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{card.label}</p>
              <p className="mt-2 text-base font-semibold text-white">{card.value}</p>
              <p className="mt-1.5 text-xs leading-5 text-slate-300">{card.hint}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-2xl border border-white/10 bg-black/10 p-5">
          <p className="text-sm font-medium text-white">What appears after upload</p>
          <ul className="mt-3 grid gap-2 text-sm leading-6 text-slate-300 sm:grid-cols-2">
            {WHAT_APPEARS.map((item) => (
              <li key={item} className="flex items-start gap-2">
                <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent/60" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </motion.div>
    </div>
  );
}
