import { motion } from "framer-motion";
import { UploadBox } from "@/components/UploadBox";
import StudentPathEntryCard from "@/components/StudentPathEntryCard";

export function Home() {
  return (
    <div className="space-y-8">
      <section className="grid gap-6 xl:grid-cols-[1.45fr_0.95fr] xl:items-stretch">
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 shadow-[0_18px_50px_rgba(0,0,0,0.18)] backdrop-blur-sm md:p-8">
          <div className="max-w-3xl">
            <motion.p
              className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-accent"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.05 }}
            >
              Smart Career Analysis
            </motion.p>

            <h1 className="font-display text-4xl font-bold leading-tight text-white md:text-5xl">
              See where your CV fits{" "}
              <span className="bg-gradient-to-r from-accent to-match bg-clip-text text-transparent">
                before you apply
              </span>
              .
            </h1>

            <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-400 md:text-base">
              Upload a PDF resume. We extract text, detect skills against the live
              job catalog, and show role matches, gaps, and next steps from your CV.
            </p>
          </div>

          <motion.div
            className="mt-8"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.12, duration: 0.35 }}
          >
            <UploadBox />
          </motion.div>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {[
              { t: "Role matches", d: "Job cards with match % and skill coverage." },
              { t: "Gap aware", d: "Missing and partial skills surface per role." },
              { t: "Live catalog", d: "Every score is computed against the loaded job dataset." },
            ].map((item, i) => (
              <motion.div
                key={item.t}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 + i * 0.06 }}
                className="rounded-2xl border border-white/5 bg-white/[0.02] p-4 text-left"
              >
                <p className="font-display text-sm font-semibold text-white">{item.t}</p>
                <p className="mt-1 text-xs leading-6 text-slate-500">{item.d}</p>
              </motion.div>
            ))}
          </div>
        </div>

        <StudentPathEntryCard />
      </section>
    </div>
  );
}