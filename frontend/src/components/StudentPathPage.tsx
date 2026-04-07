import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import StudentPathResults from "@/components/StudentPathResults";
import { mapAnalyzeCvToAnalysisResponse } from "@/api/mapAnalyzeCvResponse";
import type { AnalysisResponse, AnalyzeCVApiResponse } from "@/types/api";

const API_BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ||
  "http://127.0.0.1:8000";

function InfoCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{label}</p>
      <p className="mt-2 text-lg font-semibold text-white leading-snug">{value}</p>
      {hint ? <p className="mt-2 text-sm leading-6 text-slate-300">{hint}</p> : null}
    </div>
  );
}

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

  const compactTopBar = analysis ? (
    <section className="mb-6 rounded-3xl border border-white/10 bg-white/[0.03] p-5 shadow-[0_18px_50px_rgba(0,0,0,0.18)] backdrop-blur-sm">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent/80">
            Student mode
          </p>
          <h1 className="mt-2 text-2xl font-semibold text-white">
            Student Path Explorer
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            Your CV has been analyzed. Explore paths, roles inside each path,
            and what to learn next.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200">
            {selectedFileLabel ? `Selected: ${selectedFileLabel}` : "CV analyzed"}
          </div>

          <button
            type="button"
            onClick={resetAll}
            className="rounded-full border border-white/10 bg-white/5 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-white/10"
          >
            Analyze another CV
          </button>
        </div>
      </div>
    </section>
  ) : null;

  const preAnalysisLayout = (
    <section className="grid min-h-[calc(100vh-180px)] gap-8 xl:grid-cols-[420px_minmax(0,1fr)] xl:items-stretch">
      <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 shadow-[0_18px_50px_rgba(0,0,0,0.18)] backdrop-blur-sm md:p-7">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent/80">
          Student mode
        </p>
        <h1 className="mt-3 text-3xl font-semibold leading-tight text-white md:text-4xl">
          Explore the right path for your current profile
        </h1>
        <p className="mt-4 text-sm leading-7 text-slate-300">
          This mode is designed for students who want to know:
          which technical path fits them, which roles live inside that path,
          and what they should learn next.
        </p>

        <div className="mt-6 rounded-3xl border border-dashed border-white/15 bg-black/10 p-5">
          <label className="block cursor-pointer">
            <input
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(event) => {
                const selected = event.target.files?.[0] ?? null;
                setFile(selected);
              }}
            />

            <div className="flex min-h-[210px] flex-col items-center justify-center rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-center transition hover:bg-white/[0.04]">
              <span className="rounded-full border border-accent/20 bg-accent/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-accent">
                PDF only
              </span>
              <h2 className="mt-5 text-2xl font-semibold text-white">Upload your CV</h2>
              <p className="mt-3 max-w-sm text-sm leading-6 text-slate-300">
                The system will analyze your current strengths, detect possible paths,
                and explain what to learn for each one.
              </p>
            </div>
          </label>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200">
              {selectedFileLabel ? `Selected: ${selectedFileLabel}` : "No file selected"}
            </div>

            <button
              type="button"
              onClick={handleAnalyze}
              disabled={!file || loading}
              className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Analyzing..." : "Explore student paths"}
            </button>

            <button
              type="button"
              onClick={resetAll}
              className="rounded-full border border-white/10 bg-white/5 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-white/10"
            >
              Clear
            </button>
          </div>

          {errorText ? (
            <div className="mt-4 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
              {errorText}
            </div>
          ) : null}
        </div>
      </div>

      <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 shadow-[0_18px_50px_rgba(0,0,0,0.18)] backdrop-blur-sm md:p-7">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent/80">
          Student path overview
        </p>
        <h2 className="mt-3 text-3xl font-semibold text-white">
          Choose a path before you choose a job
        </h2>
        <p className="mt-4 text-sm leading-7 text-slate-300">
          This interface is built for students. Instead of ranking jobs first,
          it turns your CV into possible directions, then shows what to learn to move into each path.
        </p>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <InfoCard
            label="Primary output"
            value="Recommended paths"
            hint="You see technical directions that match your current profile."
          />
          <InfoCard
            label="Secondary output"
            value="Entry roles"
            hint="Each path contains realistic roles you can grow into."
          />
          <InfoCard
            label="Main value"
            value="Learning roadmap"
            hint="The system highlights the skills you should learn first."
          />
          <InfoCard
            label="Best for"
            value="Students"
            hint="Ideal when you want direction before applying for jobs."
          />
        </div>

        <div className="mt-6 rounded-2xl border border-white/10 bg-black/10 p-5">
          <p className="text-sm font-medium text-white">What appears after upload</p>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-300">
            <li>• recommended paths sorted by fit</li>
            <li>• the roles that belong to each path</li>
            <li>• the skills you already have for that path</li>
            <li>• the skills you should learn next</li>
          </ul>
        </div>
      </div>
    </section>
  );

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.10),_transparent_30%),linear-gradient(180deg,_#07111d_0%,_#050b14_100%)] text-white">
      <div className="mx-auto w-full max-w-[1680px] px-4 py-8 md:px-6 xl:px-10">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <Link
              to="/"
              className="inline-flex items-center gap-2 text-lg font-semibold text-white"
            >
              <span className="inline-flex h-3 w-3 rounded-full bg-accent" />
              CareerLens
            </Link>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300">
              Student Path Explorer helps students choose a direction before job hunting.
              Upload your CV, identify your strongest path, and see what to learn for each track.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10"
            >
              Back to main page
            </Link>
          </div>
        </header>

        {analysis ? (
          <>
            {compactTopBar}
            <StudentPathResults analysis={analysis} />
          </>
        ) : (
          preAnalysisLayout
        )}
      </div>
    </div>
  );
}