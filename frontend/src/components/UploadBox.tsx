import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { postAnalyzeCV } from "@/api/analyzeCV";
import { mapAnalyzeCvToAnalysisResponse } from "@/api/mapAnalyzeCvResponse";
import { persistAnalysis, cn } from "@/utils/helpers";

function isPdf(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function formatAxiosDetail(data: unknown): string | null {
  if (!data || typeof data !== "object" || !("detail" in data)) return null;
  const detail = (data as { detail: unknown }).detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail
      .map((item) =>
        item && typeof item === "object" && "msg" in item ? String((item as { msg: unknown }).msg) : String(item)
      )
      .join("; ");
  return String(detail);
}

function useCVUpload() {
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setFile(null);
    setError(null);
  }, []);

  const analyze = useCallback(async () => {
    if (!file) { setError("Select a PDF resume first."); return; }
    if (!isPdf(file)) { setError("Only PDF files are supported."); return; }
    setError(null);
    setLoading(true);
    try {
      const raw = await postAnalyzeCV(file);
      const result = mapAnalyzeCvToAnalysisResponse(raw);
      persistAnalysis(result);
      navigate("/results", { state: { analysis: result } });
    } catch (err: unknown) {
      const ax = err as { response?: { data?: unknown }; message?: string };
      const msg = formatAxiosDetail(ax.response?.data) || ax.message || "Analysis failed. Please try again.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [file, navigate]);

  return { file, loading, error, setFile, analyze, reset };
}

export function UploadBox() {
  const { file, loading, error, setFile, analyze, reset } = useCVUpload();
  const [dragOver, setDragOver] = useState(false);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const dropped = e.dataTransfer.files[0];
      if (dropped) setFile(dropped);
    },
    [setFile],
  );

  const onFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const picked = e.target.files?.[0];
      if (picked) setFile(picked);
    },
    [setFile],
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.38 }}
      className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] shadow-[0_32px_80px_rgba(0,0,0,0.5)] backdrop-blur-sm"
    >
      {/* Inner glow top */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-blue-500/40 to-transparent" />
      <div className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 rounded-full bg-blue-500/10 blur-3xl" />

      <div className="p-5">
        {/* Drop zone */}
        <div
          role="button"
          tabIndex={0}
          onDragEnter={() => setDragOver(true)}
          onDragLeave={() => setDragOver(false)}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDrop={onDrop}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") document.getElementById("cv-input")?.click(); }}
          onClick={() => document.getElementById("cv-input")?.click()}
          className={cn(
            "relative flex min-h-[150px] cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed transition-all duration-300",
            dragOver
              ? "border-blue-400/70 bg-blue-500/[0.07] shadow-[0_0_32px_rgba(59,130,246,0.15)]"
              : file
              ? "border-blue-500/40 bg-blue-500/[0.04]"
              : "border-white/10 bg-white/[0.015] hover:border-blue-500/30 hover:bg-blue-500/[0.03]",
          )}
        >
          <input
            id="cv-input"
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={onFileInput}
          />

          <AnimatePresence mode="wait">
            {file ? (
              /* File selected state */
              <motion.div
                key="file"
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.92 }}
                transition={{ duration: 0.22 }}
                className="flex flex-col items-center gap-3 px-6 text-center"
              >
                {/* PDF icon */}
                <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-blue-500/30 bg-blue-500/10 shadow-[0_0_20px_rgba(59,130,246,0.2)]">
                  <svg className="h-8 w-8 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.4}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                  {/* Check badge */}
                  <div className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 shadow-lg">
                    <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  </div>
                </div>
                <div>
                  <p className="max-w-[200px] truncate text-sm font-semibold text-white">{file.name}</p>
                  <p className="mt-0.5 text-xs text-slate-500">Ready to analyze</p>
                </div>
              </motion.div>
            ) : dragOver ? (
              /* Drag over state */
              <motion.div
                key="drag"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center gap-3"
              >
                <motion.div
                  animate={{ y: [0, -6, 0] }}
                  transition={{ duration: 0.8, repeat: Infinity }}
                  className="flex h-14 w-14 items-center justify-center rounded-2xl border border-blue-400/50 bg-blue-500/15"
                >
                  <svg className="h-7 w-7 text-blue-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                  </svg>
                </motion.div>
                <p className="text-sm font-semibold text-blue-300">Drop it here</p>
              </motion.div>
            ) : (
              /* Empty state */
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center gap-4 px-6 text-center"
              >
                {/* Upload icon with ring */}
                <div className="relative">
                  <div className="absolute inset-0 scale-110 rounded-full bg-blue-500/10 blur-lg" />
                  <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]">
                    <svg className="h-8 w-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.4}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                    </svg>
                  </div>
                </div>

                <div>
                  <p className="text-base font-semibold text-white">Drop your CV here</p>
                  <p className="mt-1 text-sm text-slate-500">or click to browse</p>
                </div>

                <span className="rounded-full border border-blue-500/25 bg-blue-500/10 px-3.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-400">
                  PDF only
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Error */}
        <AnimatePresence>
          {error && (
            <motion.p
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mt-3 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-2.5 text-center text-sm text-rose-300"
              role="alert"
            >
              {error}
            </motion.p>
          )}
        </AnimatePresence>

        {/* Actions */}
        <div className="mt-5 flex gap-3">
          <motion.button
            type="button"
            disabled={loading || !file}
            onClick={() => void analyze()}
            whileHover={{ scale: loading ? 1 : 1.02 }}
            whileTap={{ scale: loading ? 1 : 0.97 }}
            className={cn(
              "relative flex-1 overflow-hidden rounded-2xl py-3.5 text-sm font-bold text-white transition",
              "bg-gradient-to-r from-blue-600 to-blue-500 shadow-[0_8px_24px_rgba(59,130,246,0.35)]",
              "disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none",
            )}
          >
            {/* Shimmer */}
            {!loading && file && (
              <motion.div
                className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent"
                animate={{ x: ["-100%", "200%"] }}
                transition={{ duration: 2, repeat: Infinity, repeatDelay: 1.5 }}
              />
            )}
            <span className="relative inline-flex items-center gap-2">
              {loading ? (
                <>
                  <motion.span
                    className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white"
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 0.7, ease: "linear" }}
                  />
                  Analyzing…
                </>
              ) : (
                <>
                  Analyze CV
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                  </svg>
                </>
              )}
            </span>
          </motion.button>

          <AnimatePresence>
            {file && !loading && (
              <motion.button
                type="button"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                onClick={reset}
                className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3.5 text-sm text-slate-400 transition hover:border-white/20 hover:text-white"
              >
                Clear
              </motion.button>
            )}
          </AnimatePresence>
        </div>

      </div>
    </motion.div>
  );
}
