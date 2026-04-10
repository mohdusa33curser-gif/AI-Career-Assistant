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
  { t: "Role matches", d: "Job cards with match % and skill coverage." },
  { t: "Gap aware", d: "Missing skills surfaced per role." },
  { t: "Live catalog", d: "Scored against the loaded job dataset." },
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
        try {
          const payload = await response.json();
          message = payload?.detail || message;
        } catch { /* ignore */ }
        throw new Error(message);
      }
      const payload = (await response.json()) as AnalyzeCVApiResponse;
      const analysis = mapAnalyzeCvToAnalysisResponse(payload);
      
      // ✅ بدل ما نعرض النتائج داخل المودال، نغلقه وننتقل للصفحة الكاملة
      onAnalysisComplete(analysis, file.name);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Unexpected error.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)" }}
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.93, y: 28 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 16 }}
          transition={{ duration: 0.32, ease: "easeOut" }}
          className="relative w-full max-w-6xl overflow-hidden rounded-3xl border border-amber-500/25 bg-slate-900/92" // ✅ max-w-5xl → max-w-6xl
          style={{
            backdropFilter: "blur(20px)",
            maxHeight: "92vh", // ✅ 88vh → 92vh
            overflowY: "auto",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Background glow */}
          <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-amber-500/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-16 -left-16 h-56 w-56 rounded-full bg-amber-500/[0.06] blur-3xl" />

          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute right-5 top-5 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-400 transition hover:bg-white/10 hover:text-slate-200"
          >
            ✕
          </button>

          <div className="p-8 md:p-11"> {/* ✅ p-7/p-9 → p-8/p-11 */}
            {/* Header */}
            <div className="mb-8"> {/* ✅ mb-6 → mb-8 */}
              <div className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-400">
                  Student Path Explorer
                </span>
              </div>
              <h2 className="mt-2 font-display text-3xl font-bold text-slate-100 md:text-4xl"> {/* ✅ أكبر */}
                Not ready for jobs yet?{" "}
                <span className="text-amber-400">Find your path first.</span>
              </h2>
              <p className="mt-3 text-base leading-7 text-slate-400"> {/* ✅ text-sm → text-base */}
                Upload your CV to discover which technical paths fit you best, what roles live inside each, and what to learn next.
              </p>
            </div>

            {/* Main two-column layout */}
            <div className="grid gap-6 md:grid-cols-[420px_minmax(0,1fr)]"> {/* ✅ 380px → 420px, gap-5 → gap-6 */}

              {/* LEFT: Upload */}
              <div className="flex flex-col rounded-2xl border border-amber-500/20 bg-amber-500/[0.05] p-6"> {/* ✅ p-5 → p-6 */}
                <label className="block cursor-pointer flex-1">
                  <input
                    type="file"
                    accept="application/pdf"
                    className="hidden"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                  <div className="flex min-h-[200px] flex-col items-center justify-center rounded-xl border border-dashed border-amber-500/25 bg-black/10 p-6 text-center transition hover:bg-amber-500/[0.05]"> {/* ✅ min-h-[160px] → 200px */}
                    <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-amber-400">
                      PDF only
                    </span>
                    <h3 className="mt-4 text-lg font-semibold text-white">Upload your CV</h3> {/* ✅ text-base → text-lg */}
                    <p className="mt-2 max-w-xs text-sm leading-6 text-slate-400"> {/* ✅ text-xs → text-sm */}
                      We'll analyze your strengths and detect possible career paths.
                    </p>
                  </div>
                </label>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <div className="flex-1 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs text-slate-300 truncate">
                    {selectedFileLabel ? `✓ ${selectedFileLabel}` : "No file selected"}
                  </div>
                  <button
                    type="button"
                    onClick={handleAnalyze}
                    disabled={!file || loading}
                    className="rounded-full bg-amber-500 px-6 py-2.5 text-xs font-semibold text-slate-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50" // ✅ أكبر قليلاً
                  >
                    {loading ? "Analyzing..." : "Explore paths →"}
                  </button>
                </div>

                {errorText && (
                  <div className="mt-3 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-xs text-rose-100">
                    {errorText}
                  </div>
                )}

                {/* Pills */}
                <div className="mt-5 flex flex-wrap gap-1.5">
                  {STUDENT_PILLS.map((pill) => (
                    <span
                      key={pill}
                      className="rounded-full border border-amber-500/20 bg-white/[0.04] px-3 py-1 text-[10px] text-slate-400"
                    >
                      {pill}
                    </span>
                  ))}
                </div>
              </div>

              {/* RIGHT: Info */}
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-3">
                  {INFO_CARDS.map((card) => (
                    <div key={card.label} className="rounded-2xl border border-white/10 bg-black/10 p-5"> {/* ✅ p-4 → p-5 */}
                      <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400">{card.label}</p>
                      <p className="mt-1.5 text-sm font-semibold text-white">{card.value}</p>
                      <p className="mt-1 text-[11px] leading-5 text-slate-400">{card.hint}</p>
                    </div>
                  ))}
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/10 p-6"> {/* ✅ p-5 → p-6 */}
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

  // ✅ عندما تكتمل النتائج: أغلق المودال وانتقل لصفحة النتائج الكاملة
  function handleAnalysisComplete(analysis: AnalysisResponse, fileName: string) {
    setShowStudentModal(false);
    setStudentAnalysis(analysis);
    setStudentFileName(fileName);
  }

  function handleResetStudent() {
    setStudentAnalysis(null);
    setStudentFileName("");
  }

  // ✅ إذا عندنا نتائج، اعرض صفحة StudentPathResults كاملة
  if (studentAnalysis) {
    return (
      <div className="flex flex-col gap-4 p-2">
        <div className="rounded-3xl border border-amber-500/20 bg-gradient-to-br from-slate-900 to-slate-800/80 p-8">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-400">
                  Student Path Explorer
                </span>
              </div>
              <p className="text-sm text-slate-400">
                Analyzed: <span className="text-slate-200">{studentFileName}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={handleResetStudent}
              className="rounded-full border border-white/10 bg-white/5 px-5 py-2 text-xs font-medium text-white transition hover:bg-white/10"
            >
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
      <div className="flex flex-col gap-4 p-2">
        {/* HERO: Smart Career Analysis — ✅ أكبر وأكثر أهمية */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.38 }}
          className="relative overflow-hidden rounded-3xl border border-blue-500/25 bg-gradient-to-br from-slate-900 via-slate-900/95 to-slate-800/80 p-10 md:p-14" // ✅ padding أكبر، border أقوى
          style={{ minHeight: "calc(100vh - 120px)" }} // ✅ أكبر
        >
          {/* ✅ glows أكثر وضوحاً */}
          <div className="pointer-events-none absolute -right-20 -top-20 h-96 w-96 rounded-full bg-blue-500/15 blur-3xl" />
          <div className="pointer-events-none absolute -left-20 bottom-0 h-64 w-64 rounded-full bg-blue-400/8 blur-3xl" />

          <div className="flex h-full flex-col justify-between gap-10">
            <div className="grid gap-10 md:grid-cols-2 md:items-center">
              {/* Left */}
              <div>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.08 }}
                  className="mb-4 flex items-center gap-2"
                >
                  <span className="h-2 w-2 rounded-full bg-blue-400" /> {/* ✅ أكبر */}
                  <span className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-400"> {/* ✅ text-[11px] → text-xs */}
                    Smart Career Analysis
                  </span>
                </motion.div>

                <h1 className="font-display text-5xl font-bold leading-tight text-slate-100 md:text-6xl"> {/* ✅ 4xl/5xl → 5xl/6xl */}
                  See where your CV fits{" "}
                  <span className="text-blue-400">before you apply.</span>
                </h1>

                <p className="mt-5 text-lg leading-8 text-slate-400"> {/* ✅ text-base → text-lg */}
                  Upload your CV. We analyze your skills against real job requirements and return precise role matches, identified gaps, and clear next steps
                </p>

                <div className="mt-10 grid grid-cols-3 gap-4"> {/* ✅ mt-8 → mt-10, gap-3 → gap-4 */}
                  {CAREER_FEATURES.map((item, i) => (
                    <motion.div
                      key={item.t}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.2 + i * 0.06 }}
                      className="rounded-xl border border-blue-500/15 bg-blue-500/[0.05] p-5" // ✅ border/bg أكثر وضوحاً
                    >
                      <p className="text-sm font-semibold text-slate-200">{item.t}</p> {/* ✅ text-xs → text-sm */}
                      <p className="mt-2 text-xs leading-5 text-slate-500">{item.d}</p>
                    </motion.div>
                  ))}
                </div>
              </div>

              {/* Right: Upload */}
              <motion.div
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.14, duration: 0.35 }}
              >
                <UploadBox />
              </motion.div>
            </div>

            {/* Student Banner — ✅ أصغر نسبياً مقارنة بالهيرو الرئيسي */}
            <motion.button
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: 0.3 }}
              onClick={() => setShowStudentModal(true)}
              className="group flex w-full cursor-pointer items-center justify-between gap-4 rounded-2xl border border-amber-500/20 bg-amber-500/[0.05] px-6 py-4 text-left transition hover:border-amber-500/35 hover:bg-amber-500/[0.09]" // ✅ py-5 → py-4, border/bg أخف
            >
              <div className="flex items-center gap-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-amber-500/25 bg-amber-500/8 text-amber-400 text-base"> {/* ✅ أصغر قليلاً */}
                  ✦
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-400">
                    Student Path Explorer
                  </p>
                  <p className="mt-0.5 text-sm font-semibold text-slate-100">
                    Not ready for jobs yet?{" "}
                    <span className="text-amber-400">Find your path first.</span>
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-3">
                <div className="hidden flex-wrap justify-end gap-1.5 sm:flex">
                  {STUDENT_PILLS.map((pill) => (
                    <span
                      key={pill}
                      className="rounded-full border border-amber-500/20 bg-white/[0.04] px-2.5 py-0.5 text-[10px] text-slate-400"
                    >
                      {pill}
                    </span>
                  ))}
                </div>
                <span className="flex h-8 w-8 items-center justify-center rounded-full border border-amber-500/25 bg-amber-500/8 text-amber-400 transition group-hover:bg-amber-500/18">
                  →
                </span>
              </div>
            </motion.button>
          </div>
        </motion.div>
      </div>

      {showStudentModal && (
        <StudentModal
          onClose={() => setShowStudentModal(false)}
          onAnalysisComplete={handleAnalysisComplete}
        />
      )}
    </>
  );
}