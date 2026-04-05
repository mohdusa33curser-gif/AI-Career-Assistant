import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { postAnalyzeCV } from "@/api/analyzeCV";
import { mapAnalyzeCvToAnalysisResponse } from "@/api/mapAnalyzeCvResponse";
import { persistAnalysis, cn } from "@/utils/helpers";

function isPdf(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function formatAxiosDetail(data: unknown): string | null {
  if (!data || typeof data !== "object" || !("detail" in data)) {
    return null;
  }
  const detail = (data as { detail: unknown }).detail;
  if (typeof detail === "string") {
    return detail;
  }
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (item && typeof item === "object" && "msg" in item) {
          return String((item as { msg: unknown }).msg);
        }
        return String(item);
      })
      .join("; ");
  }
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
    if (!file) {
      setError("Select a PDF resume first.");
      return;
    }
    if (!isPdf(file)) {
      setError("Only PDF files are supported.");
      return;
    }

    setError(null);
    setLoading(true);
    try {
      const raw = await postAnalyzeCV(file);
      const result = mapAnalyzeCvToAnalysisResponse(raw);
      persistAnalysis(result);
      navigate("/results", { state: { analysis: result } });
    } catch (err: unknown) {
      const ax = err as { response?: { data?: unknown }; message?: string };
      const msg =
        formatAxiosDetail(ax.response?.data) || ax.message || "Analysis failed. Please try again.";
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
      if (dropped) {
        setFile(dropped);
      }
    },
    [setFile],
  );

  const onFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const picked = e.target.files?.[0];
      if (picked) {
        setFile(picked);
      }
    },
    [setFile],
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className={cn(
        "mx-auto max-w-xl rounded-2xl border border-white/10 bg-surface-card/90 p-6 shadow-xl shadow-black/40",
        "ring-1 ring-inset ring-white/5 backdrop-blur-sm",
      )}
    >
      <div
        role="button"
        tabIndex={0}
        onDragEnter={() => setDragOver(true)}
        onDragLeave={() => setDragOver(false)}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDrop={onDrop}
        className={cn(
          "relative flex min-h-[200px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed transition-colors",
          dragOver ? "border-accent bg-accent/5" : "border-white/15 bg-white/[0.02]",
        )}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            document.getElementById("cv-input")?.click();
          }
        }}
        onClick={() => document.getElementById("cv-input")?.click()}
      >
        <input
          id="cv-input"
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={onFileInput}
        />
        <motion.div
          animate={{ scale: dragOver ? 1.03 : 1 }}
          className="pointer-events-none flex flex-col items-center gap-2 px-6 text-center"
        >
          <span className="rounded-full bg-accent/15 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-accent">
            PDF only
          </span>
          <p className="font-display text-lg text-white">Drop your CV here</p>
          <p className="text-sm text-slate-500">or click to browse</p>
        </motion.div>
      </div>

      {file && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-4 truncate text-center text-sm text-slate-400"
        >
          Selected: <span className="text-white">{file.name}</span>
        </motion.p>
      )}

      {error && (
        <p className="mt-3 text-center text-sm text-miss" role="alert">
          {error}
        </p>
      )}

      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <motion.button
          type="button"
          disabled={loading || !file}
          onClick={() => void analyze()}
          whileHover={{ scale: loading ? 1 : 1.02 }}
          whileTap={{ scale: loading ? 1 : 0.98 }}
          className={cn(
            "rounded-full bg-accent px-8 py-3 font-semibold text-surface shadow-lg shadow-accent/25",
            "disabled:cursor-not-allowed disabled:opacity-40",
          )}
        >
          {loading ? (
            <span className="inline-flex items-center gap-2">
              <motion.span
                className="h-4 w-4 rounded-full border-2 border-surface border-t-transparent"
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 0.7, ease: "linear" }}
              />
              Analyzing…
            </span>
          ) : (
            "Analyze CV"
          )}
        </motion.button>
        {file && !loading && (
          <button
            type="button"
            onClick={reset}
            className="rounded-full border border-white/15 px-5 py-3 text-sm text-slate-400 hover:border-white/25 hover:text-white"
          >
            Clear
          </button>
        )}
      </div>
    </motion.div>
  );
}
