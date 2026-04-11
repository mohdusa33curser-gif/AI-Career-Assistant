import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { UploadBox } from "@/components/UploadBox";
import StudentPathResults from "@/components/StudentPathResults";
import { mapAnalyzeCvToAnalysisResponse } from "@/api/mapAnalyzeCvResponse";
import type { AnalysisResponse, AnalyzeCVApiResponse } from "@/types/api";

const API_BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ||
  "http://127.0.0.1:8000";

const CAREER_FEATURES = [
  {
    t: "Role matches",
    d: "Ranked by match % and skill coverage.",
    icon: "M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 00.75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 00-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0112 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 01-.673-.38m0 0A2.18 2.18 0 013 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 013.413-.387m7.5 0V5.25A2.25 2.25 0 0013.5 3h-3a2.25 2.25 0 00-2.25 2.25v.894m7.5 0a48.667 48.667 0 00-7.5 0M12 12.75h.008v.008H12v-.008z",
  },
  {
    t: "Gap aware",
    d: "Missing skills surfaced per role.",
    icon: "M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z",
  },
  {
    t: "Live catalog",
    d: "Scored against the full job dataset.",
    icon: "M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5M9 11.25v1.5M12 9v3.75m3-6v6",
  },
];

const STUDENT_PILLS = ["Learning roadmap", "Path suggestions", "Skill gaps"];

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

function StudentModal({ onClose, onAnalysisComplete }: {
  onClose: () => void;
  onAnalysisComplete: (analysis: AnalysisResponse, fileName: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const selectedFileLabel = useMemo(() => file?.name ?? null, [file]);

  async function handleAnalyze() {
    if (!file || loading) return;
    setLoading(true);
    setErrorText(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch(`${API_BASE}/analyze-cv?top_k=20&sort_by=match`, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        let message = "Failed to analyze CV.";
        try { const p = await response.json(); message = p?.detail || message; } catch { /* ignore */ }
        throw new Error(message);
      }
      const payload = (await response.json()) as AnalyzeCVApiResponse;
      onAnalysisComplete(mapAnalyzeCvToAnalysisResponse(payload), file.name);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Unexpected error.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ backgroundColor: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.93, y: 28 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 16 }}
          transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
          className="relative w-full max-w-6xl overflow-hidden rounded-3xl border border-amber-500/25 bg-slate-900/95"
          style={{ backdropFilter: "blur(20px)", maxHeight: "92vh", overflowY: "auto" }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-amber-500/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-16 -left-16 h-56 w-56 rounded-full bg-amber-500/[0.06] blur-3xl" />
          <button onClick={onClose} className="absolute right-5 top-5 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-400 transition hover:bg-white/10 hover:text-slate-200">✕</button>

          <div className="p-8 md:p-11">
            <div className="mb-8">
              <div className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-400">Student Path Explorer</span>
              </div>
              <h2 className="mt-2 text-3xl font-bold text-slate-100 md:text-4xl">
                Not ready for jobs yet? <span className="text-amber-400">Find your path first.</span>
              </h2>
              <p className="mt-3 text-base leading-7 text-slate-400">
                Upload your CV to discover which technical paths fit you best, what roles live inside each, and what to learn next.
              </p>
            </div>

            <div className="grid gap-6 md:grid-cols-[420px_minmax(0,1fr)]">
              <div className="flex flex-col rounded-2xl border border-amber-500/20 bg-amber-500/[0.05] p-6">
                <label className="block cursor-pointer flex-1">
                  <input type="file" accept="application/pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                  <div className="flex min-h-[200px] flex-col items-center justify-center rounded-xl border border-dashed border-amber-500/25 bg-black/10 p-6 text-center transition hover:bg-amber-500/[0.05]">
                    <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-amber-400">PDF only</span>
                    <h3 className="mt-4 text-lg font-semibold text-white">Upload your CV</h3>
                    <p className="mt-2 max-w-xs text-sm leading-6 text-slate-400">We'll analyze your strengths and detect possible career paths.</p>
                  </div>
                </label>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <div className="flex-1 truncate rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs text-slate-300">
                    {selectedFileLabel ? `✓ ${selectedFileLabel}` : "No file selected"}
                  </div>
                  <button type="button" onClick={handleAnalyze} disabled={!file || loading}
                    className="rounded-full bg-amber-500 px-6 py-2.5 text-xs font-semibold text-slate-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50">
                    {loading ? "Analyzing..." : "Explore paths →"}
                  </button>
                </div>
                {errorText && <div className="mt-3 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-xs text-rose-100">{errorText}</div>}
                <div className="mt-5 flex flex-wrap gap-1.5">
                  {STUDENT_PILLS.map((pill) => (
                    <span key={pill} className="rounded-full border border-amber-500/20 bg-white/[0.04] px-3 py-1 text-[10px] text-slate-400">{pill}</span>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-3">
                  {INFO_CARDS.map((card) => (
                    <div key={card.label} className="rounded-2xl border border-white/10 bg-black/10 p-5">
                      <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400">{card.label}</p>
                      <p className="mt-1.5 text-sm font-semibold text-white">{card.value}</p>
                      <p className="mt-1 text-[11px] leading-5 text-slate-400">{card.hint}</p>
                    </div>
                  ))}
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/10 p-6">
                  <p className="text-sm font-medium text-white">What appears after upload</p>
                  <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                    {WHAT_APPEARS.map((item) => (
                      <li key={item} className="flex items-start gap-2 text-xs leading-6 text-slate-300">
                        <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400/60" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export function Home() {
  const [showStudentModal, setShowStudentModal] = useState(false);
  const [studentAnalysis, setStudentAnalysis] = useState<AnalysisResponse | null>(null);
  const [studentFileName, setStudentFileName] = useState<string>("");

  function handleAnalysisComplete(analysis: AnalysisResponse, fileName: string) {
    setShowStudentModal(false);
    setStudentAnalysis(analysis);
    setStudentFileName(fileName);
  }

  function handleResetStudent() {
    setStudentAnalysis(null);
    setStudentFileName("");
  }

  if (studentAnalysis) {
    return (
      <div className="flex flex-col gap-4 p-2">
        <div className="rounded-3xl border border-amber-500/20 bg-gradient-to-br from-slate-900 to-slate-800/80 p-8">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <div className="mb-2 flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-400">Student Path Explorer</span>
              </div>
              <p className="text-sm text-slate-400">Analyzed: <span className="text-slate-200">{studentFileName}</span></p>
            </div>
            <button type="button" onClick={handleResetStudent}
              className="rounded-full border border-white/10 bg-white/5 px-5 py-2 text-xs font-medium text-white transition hover:bg-white/10">
              ← Back to home
            </button>
          </div>
          <StudentPathResults analysis={studentAnalysis} />
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Outer: no padding, fills remaining viewport exactly */}
      <div className="flex flex-col" style={{ height: "calc(100vh - 105px)" }}>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.38 }}
          className="relative flex flex-1 flex-col overflow-hidden rounded-3xl"
        >
          {/* Background */}
          <div className="absolute inset-0 bg-[#080b14]" />
          <div className="absolute inset-0 opacity-[0.035]" style={{
            backgroundImage: "linear-gradient(rgba(255,255,255,0.6) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.6) 1px,transparent 1px)",
            backgroundSize: "48px 48px",
          }} />
          <div className="pointer-events-none absolute -right-28 -top-28 h-[480px] w-[480px] rounded-full bg-blue-600/20 blur-[120px]" />
          <div className="pointer-events-none absolute -left-20 bottom-0 h-80 w-80 rounded-full bg-indigo-600/15 blur-[100px]" />
          {/* Amber glow anchored to bottom section */}
          <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-[38%] bg-gradient-to-t from-amber-950/20 to-transparent" />
          <div className="pointer-events-none absolute bottom-10 right-1/4 h-56 w-56 rounded-full bg-amber-500/8 blur-[80px]" />

          <motion.div
            animate={{ scale: [1, 1.06, 1], opacity: [0.06, 0.02, 0.06] }}
            transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
            className="pointer-events-none absolute right-[18%] top-[10%] h-64 w-64 rounded-full border border-blue-400/20"
          />
          <div className="absolute inset-0 rounded-3xl border border-white/[0.07]" />

          {/* ── Main content ── */}
          <div className="relative flex flex-1 flex-col gap-4 p-6 md:p-8">

            {/* TOP: hero grid */}
            <div className="grid flex-1 gap-8 md:grid-cols-2 md:items-center">

              {/* LEFT */}
              <div>
                <motion.div
                  initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 }}
                  className="mb-4 inline-flex items-center gap-2 rounded-full border border-blue-500/25 bg-blue-500/10 px-4 py-1.5"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
                  <span className="text-xs font-semibold uppercase tracking-[0.22em] text-blue-400">Smart Career Analysis</span>
                </motion.div>

                <motion.h1
                  initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.4 }}
                  className="text-4xl font-bold leading-[1.12] tracking-tight text-white md:text-5xl"
                >
                  See where your CV fits{" "}
                  <span className="bg-gradient-to-r from-blue-400 via-cyan-400 to-blue-300 bg-clip-text text-transparent">
                    before you apply.
                  </span>
                </motion.h1>

                <motion.p
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 }}
                  className="mt-4 max-w-lg text-sm leading-7 text-slate-400"
                >
                  Upload your CV. We analyze your skills against real job requirements and return precise role matches, identified gaps, and clear next steps.
                </motion.p>

                <div className="mt-5 grid grid-cols-3 gap-2.5">
                  {CAREER_FEATURES.map((item, i) => (
                    <motion.div
                      key={item.t}
                      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.28 + i * 0.07 }}
                      className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-3.5 transition hover:border-blue-500/20 hover:bg-blue-500/[0.04]"
                    >
                      <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg border border-blue-500/20 bg-blue-500/10">
                        <svg className="h-4 w-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
                          <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                        </svg>
                      </div>
                      <p className="text-xs font-semibold text-slate-100">{item.t}</p>
                      <p className="mt-1 text-[10px] leading-4 text-slate-500">{item.d}</p>
                    </motion.div>
                  ))}
                </div>
              </div>

              {/* RIGHT: Upload */}
              <motion.div
                initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.18, duration: 0.38 }}
              >
                <UploadBox />
              </motion.div>
            </div>

            {/* ── STUDENT PATH — prominent bottom section ── */}
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.38, delay: 0.35 }}
              className="relative overflow-hidden rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-950/40 via-amber-900/20 to-transparent"
            >
              {/* Amber glow inside */}
              <div className="pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full bg-amber-500/15 blur-3xl" />
              <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-500/40 to-transparent" />

              <div className="relative flex items-center gap-6 px-6 py-5">

                {/* Icon */}
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-amber-500/30 bg-amber-500/15 text-2xl shadow-[0_0_20px_rgba(245,158,11,0.2)]">
                  ✦
                </div>

                {/* Text block */}
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-amber-400">
                    Student Path Explorer
                  </p>
                  <h3 className="mt-0.5 text-xl font-bold text-white">
                    Not ready for jobs yet?{" "}
                    <span className="text-amber-400">Find your path first.</span>
                  </h3>
                  <p className="mt-1 text-sm text-slate-400">
                    Discover which technical paths fit your profile, with a personalized learning roadmap.
                  </p>
                  {/* Pills */}
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {STUDENT_PILLS.map((pill) => (
                      <span key={pill} className="rounded-full border border-amber-500/25 bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-medium text-amber-300">
                        {pill}
                      </span>
                    ))}
                  </div>
                </div>

                {/* CTA */}
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setShowStudentModal(true)}
                  className="shrink-0 rounded-2xl border border-amber-500/30 bg-amber-500/15 px-6 py-3.5 text-sm font-bold text-amber-300 shadow-[0_4px_20px_rgba(245,158,11,0.15)] transition hover:bg-amber-500/25 hover:text-amber-200 hover:shadow-[0_4px_28px_rgba(245,158,11,0.25)]"
                >
                  Explore paths →
                </motion.button>
              </div>
            </motion.div>

          </div>
        </motion.div>
      </div>

      {showStudentModal && (
        <StudentModal onClose={() => setShowStudentModal(false)} onAnalysisComplete={handleAnalysisComplete} />
      )}
    </>
  );
}
