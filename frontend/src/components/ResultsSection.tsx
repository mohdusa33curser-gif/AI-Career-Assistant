import type { ReactNode } from "react";
import { motion } from "framer-motion";
import type { AnalysisResponse, CareerPath, JobMatch, Skill } from "@/types/api";
import { cn, formatPercent } from "@/utils/helpers";

function Card({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay }}
      className={cn(
        "rounded-2xl border border-white/10 bg-surface-card/90 p-6 shadow-xl shadow-black/40",
        "ring-1 ring-inset ring-white/5 backdrop-blur-sm",
        className,
      )}
    >
      {children}
    </motion.div>
  );
}

function buildPathSkillGroups(path: CareerPath): {
  matchedRequired: Skill[];
  missingRequired: Skill[];
  extraMissing: Skill[];
} {
  const matchedRequired: Skill[] = path.requiredSkills
    .filter((name) => !path.missingSkills.includes(name))
    .map((name) => ({
      name,
      importance: "High" as const,
      status: "matched" as const,
    }));
  const missingRequired: Skill[] = path.requiredSkills
    .filter((name) => path.missingSkills.includes(name))
    .map((name) => ({
      name,
      importance: "High" as const,
      status: "missing" as const,
    }));
  const extraMissing: Skill[] = path.missingSkills
    .filter((name) => !path.requiredSkills.includes(name))
    .map((name) => ({
      name,
      importance: "Moderate" as const,
      status: "missing" as const,
    }));
  return { matchedRequired, missingRequired, extraMissing };
}

function ReadinessRing({ score }: { score: number }) {
  const clamped = Math.min(100, Math.max(0, score));
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - clamped / 100);

  return (
    <div className="relative flex flex-col items-center justify-center">
      <svg width={140} height={140} className="-rotate-90">
        <circle
          cx={70}
          cy={70}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={10}
        />
        <motion.circle
          cx={70}
          cy={70}
          r={radius}
          fill="none"
          stroke="url(#ringGradResults)"
          strokeWidth={10}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: dashOffset }}
          transition={{ duration: 1.1, ease: "easeOut" }}
        />
        <defs>
          <linearGradient id="ringGradResults" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#38bdf8" />
            <stop offset="100%" stopColor="#22c55e" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <motion.span
          className="font-display text-4xl font-bold text-white"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          {clamped}
        </motion.span>
        <span className="text-xs uppercase tracking-widest text-slate-500">
          {formatPercent(clamped)} readiness
        </span>
      </div>
    </div>
  );
}

function MatchProgressBar({ value, delay = 0 }: { value: number; delay?: number }) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-slate-500">Role match</span>
        <span className="font-semibold text-accent">{formatPercent(pct)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/5">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-accent to-match"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.75, delay, ease: "easeOut" }}
        />
      </div>
    </div>
  );
}

const statusRing: Record<Skill["status"], string> = {
  matched: "ring-match/40 bg-match/15 text-match",
  missing: "ring-miss/40 bg-miss/15 text-miss",
  partial: "ring-partial/40 bg-partial/15 text-partial",
};

const importanceScale: Record<Skill["importance"], string> = {
  High: "text-sm px-3 py-1.5",
  Moderate: "text-xs px-2.5 py-1",
  Low: "text-xs px-2 py-0.5 opacity-90",
};

function SkillBadge({ skill }: { skill: Skill }) {
  return (
    <motion.span
      layout
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={{ y: -2 }}
      className={cn(
        "inline-flex items-center rounded-full font-medium ring-1",
        statusRing[skill.status],
        importanceScale[skill.importance],
      )}
      title={`${skill.name} · ${skill.importance} · ${skill.status}`}
    >
      {skill.name}
    </motion.span>
  );
}

function SkillGroup({ title, skills }: { title: string; skills: Skill[] }) {
  if (skills.length === 0) {
    return null;
  }
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</p>
      <div className="flex flex-wrap gap-2">
        {skills.map((s) => (
          <SkillBadge key={`${title}-${s.name}`} skill={s} />
        ))}
      </div>
    </motion.div>
  );
}

function GapBar({
  label,
  value,
  delay = 0,
}: {
  label: string;
  value: number;
  delay?: number;
}) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-slate-400">
        <span>{label}</span>
        <span>{Math.round(pct)}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/5">
        <motion.div
          className="h-full rounded-full bg-partial"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, delay, ease: "easeOut" }}
        />
      </div>
    </div>
  );
}

function JobMatchCard({ job, index }: { job: JobMatch; index: number }) {
  const matched = job.skills.filter((s) => s.status === "matched");
  const partial = job.skills.filter((s) => s.status === "partial");
  const missing = job.skills.filter((s) => s.status === "missing");

  return (
    <Card delay={index * 0.06} className="group transition-colors hover:border-accent/25">
      <motion.div
        whileHover={{ y: -3 }}
        transition={{ type: "spring", stiffness: 320, damping: 22 }}
        className="space-y-4"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-accent">{job.category}</p>
            <h3 className="font-display text-xl font-semibold text-white">{job.title}</h3>
          </div>
        </div>
        <MatchProgressBar value={job.matchPercent} delay={0.08 + index * 0.04} />
        <div className="grid gap-4 sm:grid-cols-1">
          <SkillGroup title="Matched" skills={matched} />
          <SkillGroup title="Partial" skills={partial} />
          <SkillGroup title="Missing" skills={missing} />
        </div>
        {job.missingSkills.length > 0 && (
          <div className="rounded-xl border border-miss/20 bg-miss/5 px-3 py-2 text-xs text-miss">
            <span className="font-semibold text-miss">Focus: </span>
            {job.missingSkills.join(" · ")}
          </div>
        )}
      </motion.div>
    </Card>
  );
}

function TopJobsBlock({
  jobs,
  emptyMessage,
}: {
  jobs: JobMatch[];
  emptyMessage?: string;
}) {
  if (jobs.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.02] px-6 py-12 text-center">
        <p className="font-display text-lg text-slate-300">No matching roles</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
          {emptyMessage ??
            "No ranked job matches for this run. Try a different CV or broaden detected skills."}
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {jobs.map((job, index) => (
        <JobMatchCard key={job.id} job={job} index={index} />
      ))}
    </div>
  );
}

export function ResultsSection({ analysis }: { analysis: AnalysisResponse }) {
  const extracted = analysis.extractedSkills ?? [];
  const hasExtracted = extracted.length > 0;

  return (
    <div>
      {analysis.analysisMessage && (
        <div
          className="mb-6 rounded-xl border border-partial/30 bg-partial/10 px-4 py-3 text-center text-sm text-partial"
          role="status"
        >
          {analysis.analysisMessage}
        </div>
      )}

      <Card className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
          Detected from your CV
        </p>
        {hasExtracted ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {extracted.map((name) => (
              <SkillBadge
                key={name}
                skill={{
                  name,
                  importance: "Moderate",
                  status: "matched",
                }}
              />
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-400">
            No dataset skills were found in this PDF. Ensure technical keywords match roles in the
            catalog (e.g. Python, SQL, AWS).
          </p>
        )}
      </Card>

      <section className="grid gap-8 lg:grid-cols-[minmax(0,280px)_1fr] lg:items-start">
        <Card className="flex flex-col items-center text-center lg:sticky lg:top-24">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
            Career readiness
          </p>
          <ReadinessRing score={analysis.readinessScore} />
          {analysis.gaps.length > 0 && (
            <div className="mt-6 w-full space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Priority gaps
              </p>
              {analysis.gaps.slice(0, 3).map((g, i) => (
                <GapBar
                  key={g.skill}
                  label={g.skill}
                  value={g.importance === "High" ? 90 : g.importance === "Moderate" ? 60 : 35}
                  delay={0.1 * i}
                />
              ))}
            </div>
          )}
        </Card>

        <div>
          <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-display text-2xl font-bold text-white">Top role matches</h2>
              <p className="text-sm text-slate-500">Ranked by skill coverage against the catalog</p>
            </div>
          </div>
          <TopJobsBlock
            jobs={analysis.topMatches}
            emptyMessage={
              hasExtracted
                ? "Skills were detected but no roles cleared the ranking threshold with the current matcher."
                : undefined
            }
          />
        </div>
      </section>

      <div className="mt-12 space-y-4">
        <h2 className="font-display text-xl font-semibold text-white">Career paths</h2>
        <p className="text-sm text-slate-500">
          Inferred from overlaps with open roles — <span className="text-slate-400">{analysis.inferredRole}</span>
        </p>
        {analysis.careerPaths.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.02] px-6 py-10 text-center text-sm text-slate-500">
            Path cards are built from your top role matches. Run an analysis that returns ranked jobs
            to see tracks here.
          </div>
        ) : (
          <div className="grid gap-5 md:grid-cols-2">
            {analysis.careerPaths.map((path, index) => {
              const { matchedRequired, missingRequired, extraMissing } = buildPathSkillGroups(path);
              return (
                <Card key={path.id} delay={index * 0.05} className="h-full">
                  <div className="mb-4 flex items-center justify-between gap-2">
                    <h3 className="font-display text-lg font-semibold text-white">{path.name}</h3>
                    <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wider text-slate-400">
                      Track
                    </span>
                  </div>
                  <SkillGroup title="Required · matched" skills={matchedRequired} />
                  <div className="mt-3">
                    <SkillGroup title="Required · missing" skills={missingRequired} />
                  </div>
                  {extraMissing.length > 0 && (
                    <div className="mt-3">
                      <SkillGroup title="Also missing" skills={extraMissing} />
                    </div>
                  )}
                  <div className="mt-4 border-t border-white/5 pt-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Steps</p>
                    <ol className="mt-2 space-y-2 text-sm text-slate-300">
                      {path.steps.map((step, i) => (
                        <li key={step} className="flex gap-2">
                          <span className="font-mono text-xs text-accent">{i + 1}</span>
                          <span>{step}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <Card className="mt-10">
        <h2 className="font-display text-lg font-semibold text-white">Recommendations</h2>
        {analysis.recommendations.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">No recommendations for this run.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {analysis.recommendations.map((rec, idx) => (
              <li
                key={`${rec.title}-${idx}`}
                className="flex gap-3 rounded-xl border border-white/5 bg-white/[0.02] p-3"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-sm font-bold text-accent">
                  {Math.round(rec.priority)}
                </span>
                <div>
                  <p className="font-medium text-white">{rec.title}</p>
                  <p className="text-xs text-slate-500">{rec.description}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
