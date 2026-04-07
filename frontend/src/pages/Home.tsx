import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { UploadBox } from "@/components/UploadBox";

const CAREER_FEATURES = [
  { t: "Role matches", d: "Job cards with match % and skill coverage." },
  { t: "Gap aware", d: "Missing and partial skills surface per role." },
  { t: "Live catalog", d: "Scored against the loaded job dataset." },
];

const STUDENT_BENEFITS = [
  "Student-friendly path instead of direct job ranking",
  "Learning roadmap for a chosen direction",
  "Which roles live inside each career path",
];

export function Home() {
  return (
    <div className="grid gap-4 md:h-[calc(100vh-7rem)] xl:grid-cols-[3fr_2fr]">
      {/* LEFT: Career Analysis – 60% */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.38 }}
        className="flex flex-col rounded-3xl border border-white/10 bg-white/[0.03] p-6 shadow-[0_18px_50px_rgba(0,0,0,0.18)] backdrop-blur-sm md:p-7"
      >
        <div>
          <motion.p
            className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-accent"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.08 }}
          >
            Smart Career Analysis
          </motion.p>

          <h1 className="font-display text-3xl font-bold leading-tight text-white md:text-4xl">
            See where your CV fits{" "}
            <span className="bg-gradient-to-r from-accent to-match bg-clip-text text-transparent">
              before you apply
            </span>
            .
          </h1>

          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">
            Upload a PDF resume. We extract text, detect skills against the live
            job catalog, and show role matches, gaps, and next steps from your CV.
          </p>
        </div>

        <motion.div
          className="mt-5 flex-1"
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.14, duration: 0.35 }}
        >
          <UploadBox />
        </motion.div>

        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {CAREER_FEATURES.map((item, i) => (
            <motion.div
              key={item.t}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.22 + i * 0.06 }}
              className="rounded-2xl border border-white/5 bg-white/[0.02] p-3"
            >
              <p className="font-display text-xs font-semibold text-white">{item.t}</p>
              <p className="mt-1 text-[11px] leading-5 text-slate-500">{item.d}</p>
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* RIGHT: Student Path Explorer – 40% */}
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.38, delay: 0.1 }}
        className="flex flex-col rounded-3xl border border-amber-500/25 bg-gradient-to-b from-amber-500/[0.08] to-white/[0.02] p-6 shadow-[0_18px_50px_rgba(0,0,0,0.18)] backdrop-blur-sm md:p-7"
      >
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.24em] text-amber-400">
            Student Path Explorer
          </p>
          <h2 className="font-display text-2xl font-bold leading-snug text-white">
            Not ready for jobs yet?{" "}
            <span className="bg-gradient-to-r from-amber-400 to-orange-300 bg-clip-text text-transparent">
              Find your path first.
            </span>
          </h2>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            Designed for students who want to know which technical path fits them,
            which roles live inside it, and what to learn next.
          </p>
        </div>

        <div className="mt-5 flex-1 rounded-2xl border border-white/10 bg-black/15 p-5">
          <p className="text-sm font-medium text-slate-100">Best when you want:</p>
          <ul className="mt-3 space-y-2">
            {STUDENT_BENEFITS.map((benefit, i) => (
              <motion.li
                key={benefit}
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 + i * 0.08 }}
                className="flex items-start gap-2.5 text-sm leading-6 text-slate-300"
              >
                <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                {benefit}
              </motion.li>
            ))}
          </ul>

          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400">Output</p>
              <p className="mt-1.5 text-xs leading-5 text-slate-200">
                Path suggestions with learning needs per direction.
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400">Best for</p>
              <p className="mt-1.5 text-xs leading-5 text-slate-200">
                Students exploring direction before job hunting.
              </p>
            </div>
          </div>
        </div>

        <Link
          to="/student-path"
          className="mt-4 inline-flex items-center justify-center gap-2 rounded-full bg-amber-500 px-6 py-3 text-sm font-semibold text-slate-950 transition hover:brightness-110"
        >
          Open Student Path Explorer
          <span>→</span>
        </Link>
      </motion.div>
    </div>
  );
}
