import { useMemo, useState, useRef, useEffect, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type {
  AnalysisResponse,
  Gap,
  JobMatch,
  LearningRoadmapItem,
  Recommendation,
  Skill,
} from "@/types/api";

function pct(value: number): string {
  const safe = Math.max(0, Math.min(100, Number(value || 0)));
  return `${Math.round(safe)}%`;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function Panel({
  children,
  className = "",
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, delay }}
      className={`rounded-3xl border border-white/10 bg-white/[0.03] shadow-[0_18px_50px_rgba(0,0,0,0.18)] backdrop-blur-sm ${className}`}
    >
      {children}
    </motion.section>
  );
}

function SectionHeading({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="min-w-0 space-y-2">
      {eyebrow ? (
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent/80">
          {eyebrow}
        </p>
      ) : null}
      <h2 className="break-words text-2xl font-semibold text-white md:text-3xl">
        {title}
      </h2>
      {subtitle ? (
        <p className="max-w-3xl break-words text-sm leading-6 text-slate-300">
          {subtitle}
        </p>
      ) : null}
    </div>
  );
}

function ReadinessRing({ score, label }: { score: number; label: string }) {
  const clamped = Math.max(0, Math.min(100, Number(score || 0)));
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - clamped / 100);

  return (
    <div className="relative flex h-36 w-36 items-center justify-center md:h-40 md:w-40">
      <svg viewBox="0 0 140 140" className="h-full w-full -rotate-90">
        <circle cx="70" cy="70" r={radius} fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="10" />
        <motion.circle
          cx="70" cy="70" r={radius} fill="none" stroke="currentColor"
          strokeWidth="10" strokeLinecap="round" className="text-accent"
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: dashOffset }}
          transition={{ duration: 1.1, ease: "easeOut" }}
          strokeDasharray={circumference}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-3xl font-bold text-white md:text-[2rem]">{Math.round(clamped)}</div>
        <div className="mt-1 px-3 text-center text-[10px] font-medium uppercase tracking-[0.18em] text-slate-300 md:text-[11px]">
          {label}
        </div>
      </div>
    </div>
  );
}

function MetricTile({ label, value, hint }: { label: string; value: string; hint?: string | null }) {
  return (
    <div className="min-w-0 rounded-2xl border border-white/10 bg-black/10 p-3.5">
      <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400">{label}</p>
      <p className="mt-2 break-words text-base font-semibold leading-7 text-white md:text-[1.1rem]">{value}</p>
      {hint ? <p className="mt-1.5 text-xs leading-5 text-slate-300">{hint}</p> : null}
    </div>
  );
}

function BreakdownBar({
  label,
  value,
  colorClass = "bg-accent",
}: {
  label: string;
  value: number;
  colorClass?: string;
}) {
  const safe = Math.max(0, Math.min(100, Number(value || 0)));
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm text-slate-300">
        <span>{label}</span>
        <span className="font-medium text-white">{pct(safe)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/10">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${safe}%` }}
          transition={{ duration: 0.55, ease: "easeOut" }}
          className={`h-full rounded-full ${colorClass}`}
        />
      </div>
    </div>
  );
}

/** Convert a raw [0,1] signal to a 0–100 display value safely. */
function signalToPct(v: number | undefined): number | null {
  if (v === undefined || v === null) return null;
  const n = Number(v);
  if (!isFinite(n)) return null;
  return Math.round(Math.max(0, Math.min(1, n)) * 100);
}

const SKILL_GROUPS: Array<{ title: string; keywords: string[] }> = [
  { title: "Programming Languages", keywords: ["python","java","javascript","typescript","c++","c#","go","php","ruby","rust","swift","kotlin","sql","r","matlab"] },
  { title: "Data & AI", keywords: ["machine learning","deep learning","data science","data analysis","data visualization","statistics","natural language processing","computer vision","tensorflow","pytorch","etl","kafka","spark","hadoop","data pipelines"] },
  { title: "Cloud & DevOps", keywords: ["aws","azure","google cloud","docker","kubernetes","ci/cd","linux","cloud","devops","terraform","redshift","cassandra"] },
  { title: "Frontend & Interfaces", keywords: ["react","angular","vue","next.js","html","css","frontend","web development"] },
  { title: "Systems & Architecture", keywords: ["backend","api","microservices","distributed systems","system design","assembly","cad"] },
];

function groupDetectedSkills(skills: string[]): Array<{ title: string; skills: string[] }> {
  const buckets = new Map<string, string[]>();
  const other: string[] = [];
  for (const skill of skills) {
    const key = normalize(skill);
    let matchedGroup: string | null = null;
    for (const group of SKILL_GROUPS) {
      if (group.keywords.some((keyword) => key.includes(keyword))) { matchedGroup = group.title; break; }
    }
    if (!matchedGroup) { other.push(skill); continue; }
    const current = buckets.get(matchedGroup) ?? [];
    current.push(skill);
    buckets.set(matchedGroup, current);
  }
  const grouped = [...buckets.entries()].map(([title, items]) => ({
    title,
    skills: [...new Set(items)].sort((a, b) => a.localeCompare(b)),
  }));
  if (other.length > 0) {
    grouped.push({ title: "Other Relevant Skills", skills: [...new Set(other)].sort((a, b) => a.localeCompare(b)) });
  }
  return grouped;
}

const statusStyles: Record<Skill["status"], string> = {
  matched: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
  partial: "border-amber-500/30 bg-amber-500/10 text-amber-200",
  missing: "border-rose-500/30 bg-rose-500/10 text-rose-200",
};

const importanceStyles: Record<Skill["importance"], string> = {
  High: "px-3 py-1.5 text-sm",
  Moderate: "px-2.5 py-1 text-xs",
  Low: "px-2 py-0.5 text-xs opacity-90",
};

function SkillBadge({ skill }: { skill: Skill }) {
  return (
    <span className={`inline-flex items-center rounded-full border font-medium ${statusStyles[skill.status]} ${importanceStyles[skill.importance]}`}>
      {skill.name}
    </span>
  );
}

function SkillGroup({ title, skills }: { title: string; skills: Skill[] }) {
  if (skills.length === 0) return null;
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-slate-200">{title}</p>
      <div className="flex flex-wrap gap-2">
        {skills.map((skill) => (
          <SkillBadge key={`${title}-${skill.name}-${skill.status}`} skill={skill} />
        ))}
      </div>
    </div>
  );
}

// ─── Score signal label helpers ───────────────────────────────────────────────

type SignalChip = { label: string; color: string; badge: string };

function getExperienceLabel(score: number | undefined): SignalChip | null {
  if (score == null) return null;
  if (score >= 0.9) return { label: "Senior Level",  color: "text-emerald-400", badge: "border-emerald-500/40 bg-emerald-500/[0.12] text-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.14)]" };
  if (score >= 0.7) return { label: "Mid-Level",     color: "text-sky-400",     badge: "border-sky-500/40 bg-sky-500/[0.12] text-sky-300 shadow-[0_0_10px_rgba(14,165,233,0.12)]" };
  if (score >= 0.4) return { label: "Entry Level",   color: "text-amber-400",   badge: "border-amber-500/40 bg-amber-500/[0.12] text-amber-300" };
  return              { label: "Stretch Role",  color: "text-rose-400",    badge: "border-rose-500/40 bg-rose-500/[0.12] text-rose-300" };
}

function getDemandLabel(score: number | undefined): SignalChip | null {
  if (score == null) return null;
  if (score >= 0.85) return { label: "High Demand",    color: "text-emerald-400", badge: "border-emerald-500/40 bg-emerald-500/[0.12] text-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.14)]" };
  if (score >= 0.65) return { label: "Growing Demand", color: "text-sky-400",     badge: "border-sky-500/40 bg-sky-500/[0.12] text-sky-300" };
  if (score >= 0.4)  return { label: "Stable Market",  color: "text-amber-400",   badge: "border-amber-500/40 bg-amber-500/[0.12] text-amber-300" };
  return               { label: "Low Demand",    color: "text-rose-400",    badge: "border-rose-500/40 bg-rose-500/[0.12] text-rose-300" };
}

function getSalaryLabel(score: number | undefined): SignalChip | null {
  if (score == null) return null;
  if (score >= 0.7) return { label: "Competitive Salary", color: "text-emerald-400", badge: "border-emerald-500/40 bg-emerald-500/[0.12] text-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.14)]" };
  if (score >= 0.4) return { label: "Average Salary",     color: "text-amber-400",   badge: "border-amber-500/40 bg-amber-500/[0.12] text-amber-300" };
  return              { label: "Below Market",       color: "text-rose-400",    badge: "border-rose-500/40 bg-rose-500/[0.12] text-rose-300" };
}

// ─── ScoreBox: combined metric card with progress bar ─────────────────────────

function ScoreBox({
  title,
  iconNode,
  combined,
  subs,
}: {
  title: string;
  iconNode: ReactNode;
  combined: number;
  subs: Array<{ label: string; value: number }>;
}) {
  const safe = Math.round(Math.max(0, Math.min(100, combined)));
  const tone =
    safe >= 70
      ? { border: "border-emerald-500/30 bg-emerald-500/[0.06]", text: "text-emerald-300", bar: "bg-emerald-500/60", icon: "bg-emerald-500/15 text-emerald-400" }
      : safe >= 40
      ? { border: "border-amber-500/30 bg-amber-500/[0.06]", text: "text-amber-300", bar: "bg-amber-500/60", icon: "bg-amber-500/15 text-amber-400" }
      : { border: "border-rose-500/30 bg-rose-500/[0.06]", text: "text-rose-300", bar: "bg-rose-500/60", icon: "bg-rose-500/15 text-rose-400" };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -1 }}
      transition={{ duration: 0.28 }}
      className={`rounded-2xl border p-3.5 ${tone.border}`}
    >
      <div className="mb-2 flex items-center gap-2">
        <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${tone.icon}`}>
          {iconNode}
        </div>
        <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-400">{title}</p>
      </div>
      <p className={`text-2xl font-bold leading-none ${tone.text}`}>{safe}%</p>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${safe}%` }}
          transition={{ duration: 0.7, ease: "easeOut", delay: 0.15 }}
          className={`h-full rounded-full ${tone.bar}`}
        />
      </div>
      <div className="mt-2.5 space-y-1">
        {subs.map(({ label, value }) => (
          <div key={label} className="flex items-center justify-between">
            <span className="text-[10px] text-slate-500">{label}</span>
            <span className="text-[10px] font-medium text-slate-300">{Math.round(value)}%</span>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

// ─── InsightPill: compact text info tile ──────────────────────────────────────

function InsightPill({
  label,
  value,
  hint,
  accent = "slate",
}: {
  label: string;
  value: string;
  hint?: string | null;
  accent?: "slate" | "rose";
}) {
  return (
    <div
      className={`min-w-0 rounded-xl border px-3 py-2 ${
        accent === "rose"
          ? "border-rose-500/20 bg-rose-500/[0.04]"
          : "border-white/10 bg-black/10"
      }`}
    >
      <p className="text-[9px] uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-0.5 line-clamp-2 text-xs font-semibold leading-4 text-white">{value}</p>
      {hint ? <p className="mt-0.5 text-[10px] text-slate-400">{hint}</p> : null}
    </div>
  );
}

function GapCard({ gap, index }: { gap: Gap; index: number }) {
  const priorityTone =
    gap.importance === "High" ? "border-rose-500/25 bg-rose-500/10"
    : gap.importance === "Moderate" ? "border-amber-500/25 bg-amber-500/10"
    : "border-sky-500/25 bg-sky-500/10";
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.26, delay: index * 0.05 }}
      className={`rounded-2xl border p-4 ${priorityTone}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-300">
            {gap.status === "partial" ? "Strengthen" : "Priority gap"}
          </p>
          <h4 className="mt-2 text-base font-semibold text-white">{gap.skill}</h4>
        </div>
        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-white">{gap.importance}</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl bg-black/10 p-3">
          <p className="text-slate-400">Job weight</p>
          <p className="mt-1 font-semibold text-white">{gap.jobWeight ?? 0}</p>
        </div>
        <div className="rounded-xl bg-black/10 p-3">
          <p className="text-slate-400">Your coverage</p>
          <p className="mt-1 font-semibold text-white">{gap.userWeight ?? 0}</p>
        </div>
      </div>
    </motion.div>
  );
}

function ActionPlan({ roadmap, recommendations }: { roadmap: LearningRoadmapItem[]; recommendations: Recommendation[] }) {
  const topRoadmap = roadmap.slice(0, 3);
  const topRecommendations = recommendations.slice(0, 2);
  return (
    <div className="grid gap-4">
      {topRoadmap.map((item, index) => (
        <div key={`${item.skill}-${index}`} className="rounded-2xl border border-white/10 bg-black/10 p-4">
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-base font-semibold text-white">{item.skill}</h4>
            <span className="rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">{item.priority}</span>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-300">{item.reason}</p>
          <p className="mt-2 text-xs uppercase tracking-[0.16em] text-slate-400">{item.estimatedImpact}</p>
        </div>
      ))}
      {topRecommendations.map((rec, index) => (
        <div key={`${rec.title}-${index}`} className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Recommendation {index + 1}</p>
          <h4 className="mt-2 text-base font-semibold text-white">{rec.title}</h4>
          <p className="mt-2 text-sm leading-6 text-slate-300">{rec.description}</p>
        </div>
      ))}
    </div>
  );
}

function buildAcceptanceSignals(job: JobMatch): string[] {
  const matched = job.skills.filter((s) => s.status === "matched").slice(0, 3);
  const partial = job.skills.filter((s) => s.status === "partial").slice(0, 2);
  const lines: string[] = [];
  if (matched.length > 0) lines.push(`You already show strong evidence in ${matched.map((s) => s.name).join(", ")}.`);
  if (job.scoreBreakdown.semanticMatchPercent >= 70) lines.push("Your project and experience language is semantically close to this role.");
  if (partial.length > 0) lines.push(`You also have partial overlap in ${partial.map((s) => s.name).join(", ")}.`);
  return lines;
}

function buildRejectionSignals(job: JobMatch): string[] {
  const missing = job.skills.filter((s) => s.status === "missing").slice(0, 4);
  const partial = job.skills.filter((s) => s.status === "partial").slice(0, 2);
  const lines: string[] = [];
  if (missing.length > 0) lines.push(`You may be rejected for lacking ${missing.map((s) => s.name).join(", ")}.`);
  if (partial.length > 0) lines.push(`Some important skills are present only partially: ${partial.map((s) => s.name).join(", ")}.`);
  if (lines.length === 0) lines.push("This role is broadly aligned with your current profile.");
  return lines;
}

function RoleInsightModal({ job, onClose }: { job: JobMatch | null; onClose: () => void }) {
  if (!job) return null;

  const matched = job.skills.filter((s) => s.status === "matched").slice(0, 9);
  const missing = job.skills.filter((s) => s.status === "missing").slice(0, 7);
  const whyThisRole = (job.whyThisRole.length > 0 ? job.whyThisRole : buildAcceptanceSignals(job)).slice(0, 3);
  const rejectionSignals = buildRejectionSignals(job).slice(0, 2);

  const sb = job.scoreBreakdown;
  const scoreTiles = [
    { label: "Semantic", value: sb.semanticMatchPercent },
    { label: "Skills", value: sb.weightedSkillPercent },
    { label: "Overlap", value: sb.exactOverlapPercent },
    { label: "Category", value: sb.categoryAlignmentPercent },
    ...(sb.demandScore != null ? [{ label: "Demand", value: sb.demandScore * 100 }] : []),
    ...(sb.experienceAlignmentScore != null ? [{ label: "Exp. Fit", value: sb.experienceAlignmentScore * 100 }] : []),
  ];

  const expSig = getExperienceLabel(job.experienceAlignmentScore);
  const demSig = getDemandLabel(job.demandScore);
  const salSig = getSalaryLabel(job.salaryScore);
  const signalChips = [expSig, demSig, salSig].filter(Boolean) as Array<{ label: string; color: string }>;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-3 backdrop-blur-sm"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.97 }}
          transition={{ duration: 0.22 }}
          className="flex h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-slate-950 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* ── Fixed header ── */}
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-white/10 p-5">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-accent/80">Role recommendation</p>
              <h3 className="mt-1 text-xl font-semibold text-white">{job.title}</h3>
              <p className="mt-1 text-[11px] text-slate-400">
                {job.category}
                <span className="mx-1.5 text-slate-600">•</span>
                {pct(job.matchPercent)} match
                {signalChips.map((chip, i) => (
                  <span key={i}>
                    <span className="mx-1.5 text-slate-600">•</span>
                    <span className={chip.color}>{chip.label}</span>
                  </span>
                ))}
              </p>
            </div>
            <button type="button" onClick={onClose}
              className="shrink-0 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10">
              Close
            </button>
          </div>

          {/* ── Body: 2-col grid ── */}
          <div className="flex min-h-0 flex-1 overflow-hidden">

            {/* LEFT: Why fit + Matched skills + Score tiles */}
            <div className="flex w-1/2 shrink-0 flex-col gap-4 overflow-y-auto border-r border-white/10 p-5">
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.04] p-4">
                <h4 className="text-sm font-semibold text-emerald-300">Why you are a fit</h4>
                <ul className="mt-3 space-y-2.5">
                  {whyThisRole.map((line, i) => (
                    <li key={i} className="flex gap-2.5 text-sm leading-5 text-slate-300">
                      <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-emerald-400" />
                      <span className="line-clamp-2">{line}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {matched.length > 0 && (
                <div>
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-400">Matched skills</p>
                  <div className="flex flex-wrap gap-1.5">
                    {matched.map((s) => (
                      <span key={s.name} className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-200">
                        {s.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Score breakdown</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {scoreTiles.map(({ label, value }) => {
                    const v = Math.round(value);
                    const col =
                      v >= 70 ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
                      : v >= 40 ? "border-amber-500/25 bg-amber-500/10 text-amber-300"
                      : "border-rose-500/25 bg-rose-500/10 text-rose-300";
                    return (
                      <div key={label} className={`rounded-xl border px-2 py-2 text-center ${col}`}>
                        <p className="text-sm font-bold">{v}%</p>
                        <p className="mt-0.5 text-[9px] opacity-70">{label}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* RIGHT: Risks + Missing + Partial skills */}
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-5">
              <div className="rounded-2xl border border-rose-500/20 bg-rose-500/[0.04] p-4">
                <h4 className="text-sm font-semibold text-rose-300">Why you may be rejected</h4>
                <ul className="mt-3 space-y-2.5">
                  {rejectionSignals.map((line, i) => (
                    <li key={i} className="flex gap-2.5 text-sm leading-5 text-slate-300">
                      <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-rose-400" />
                      <span className="line-clamp-2">{line}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {missing.length > 0 && (
                <div>
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-rose-400">Skills to acquire</p>
                  <div className="flex flex-wrap gap-1.5">
                    {missing.map((s) => (
                      <span key={s.name} className="rounded-lg border border-rose-500/25 bg-rose-500/10 px-2.5 py-1 text-xs font-medium text-rose-200">
                        {s.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {job.skills.filter((s) => s.status === "partial").length > 0 && (
                <div>
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-400">Needs strengthening</p>
                  <div className="flex flex-wrap gap-1.5">
                    {job.skills.filter((s) => s.status === "partial").slice(0, 6).map((s) => (
                      <span key={s.name} className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-200">
                        {s.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {job.whyThisRole.length > 3 && (
                <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
                  <h4 className="text-sm font-semibold text-white">Additional context</h4>
                  <ul className="mt-3 space-y-2 text-sm leading-5 text-slate-300">
                    {job.whyThisRole.slice(3, 5).map((line, i) => (
                      <li key={i} className="flex gap-2.5">
                        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-accent/60" />
                        <span className="line-clamp-2">{line}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function JobMatchCard({ job, index, onOpenInsight }: { job: JobMatch; index: number; onOpenInsight: (job: JobMatch) => void }) {
  const matched = job.skills.filter((s) => s.status === "matched").slice(0, 5);
  const missing = job.skills.filter((s) => s.status === "missing").slice(0, 4);

  const expSig = getExperienceLabel(job.experienceAlignmentScore);
  const demSig = getDemandLabel(job.demandScore);
  const salSig = getSalaryLabel(job.salaryScore);
  const signalChips = [expSig, demSig, salSig].filter(Boolean) as SignalChip[];

  const sb = job.scoreBreakdown;
  const metricPairs = [
    { label: "Match Strength", value: (sb.semanticMatchPercent + sb.weightedSkillPercent) / 2 },
    { label: "Fit Quality",    value: (sb.exactOverlapPercent + sb.categoryAlignmentPercent) / 2 },
  ];

  return (
    <motion.article
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.26, delay: index * 0.04 }}
      className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-4 shadow-[0_8px_28px_rgba(0,0,0,0.18)]"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <span className="inline-flex rounded-full border border-accent/20 bg-accent/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">
            {job.category}
          </span>
          <h3 className="mt-1.5 text-[1.05rem] font-semibold text-white leading-snug">{job.title}</h3>
        </div>
        <div className="shrink-0 rounded-xl border border-white/10 bg-black/15 px-3 py-1.5 text-center min-w-[64px]">
          <p className="text-[9px] uppercase tracking-[0.16em] text-slate-400">Match</p>
          <p className="text-[1.5rem] font-bold text-white leading-none mt-0.5">{pct(job.matchPercent)}</p>
        </div>
      </div>

      {/* Signal pill badges — primary visual */}
      {signalChips.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {signalChips.map((chip) => (
            <span
              key={chip.label}
              className={`inline-flex rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${chip.badge}`}
            >
              {chip.label}
            </span>
          ))}
        </div>
      )}

      {/* 2-block metric row — compact */}
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        {metricPairs.map(({ label, value }) => {
          const v = Math.round(Math.max(0, Math.min(100, value)));
          const barColor = v >= 70 ? "bg-emerald-500/60" : v >= 40 ? "bg-amber-500/60" : "bg-rose-500/60";
          return (
            <div key={label} className="rounded-lg border border-white/10 bg-black/10 px-2.5 py-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-slate-500">{label}</span>
                <span className="text-[10px] font-bold text-white">{v}%</span>
              </div>
              <div className="mt-1 h-0.5 overflow-hidden rounded-full bg-white/10">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${v}%` }}
                  transition={{ duration: 0.5, ease: "easeOut", delay: index * 0.04 + 0.1 }}
                  className={`h-full rounded-full ${barColor}`}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Skill groups — compact, capped */}
      <div className="mt-2 space-y-1.5 flex-1">
        {matched.length > 0 && (
          <div>
            <p className="mb-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-emerald-400/70">Strengths</p>
            <div className="flex flex-wrap gap-1">
              {matched.slice(0, 4).map((s) => <SkillBadge key={`m-${s.name}`} skill={s} />)}
            </div>
          </div>
        )}
        {missing.length > 0 && (
          <div>
            <p className="mb-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-rose-400/70">Gaps</p>
            <div className="flex flex-wrap gap-1">
              {missing.slice(0, 4).map((s) => <SkillBadge key={`x-${s.name}`} skill={s} />)}
            </div>
          </div>
        )}
      </div>

      {/* Primary CTA */}
      <div className="mt-2.5 pt-2.5 border-t border-white/10">
        <button
          type="button"
          onClick={() => onOpenInsight(job)}
          className="w-full rounded-xl bg-blue-800 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_4px_20px_rgba(0,0,0,0.35)] transition hover:brightness-110 active:scale-[0.98] flex items-center justify-center gap-2"
        >
          View Recommendation →
        </button>
      </div>
    </motion.article>
  );
}

// ─── NEW: Compact widget for Skills ──────────────────────────────────────────

function SkillsCompactWidget({
  groupedSkills,
  onClick,
}: {
  groupedSkills: Array<{ title: string; skills: string[] }>;
  onClick: () => void;
}) {
  const totalSkills = groupedSkills.reduce((sum, g) => sum + g.skills.length, 0);
  const preview = groupedSkills.slice(0, 3);

  return (
    <motion.button
      type="button"
      onClick={onClick}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.1 }}
      className="group w-full rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-left transition hover:border-emerald-500/25 hover:bg-emerald-500/[0.04]"
    >
      {/* Header row */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {/* Dot grid icon — visual representation of skills */}
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/10">
            <svg viewBox="0 0 16 16" className="h-4 w-4 text-emerald-400" fill="currentColor">
              <circle cx="3" cy="3" r="1.5"/><circle cx="8" cy="3" r="1.5"/><circle cx="13" cy="3" r="1.5"/>
              <circle cx="3" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="13" cy="8" r="1.5"/>
              <circle cx="3" cy="13" r="1.5"/><circle cx="8" cy="13" r="1.5"/><circle cx="13" cy="13" r="1.5"/>
            </svg>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-400">CV Strengths</p>
            <p className="text-sm font-semibold text-white">{totalSkills} verified skills</p>
          </div>
        </div>
        <span className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-400 transition group-hover:border-emerald-500/30 group-hover:text-emerald-300">
          →
        </span>
      </div>

      {/* Mini domain pills */}
      <div className="mt-4 flex flex-wrap gap-2">
        {preview.map((group) => (
          <div key={group.title} className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/60" />
            <span className="text-[11px] text-slate-300">{group.title}</span>
            <span className="text-[10px] text-slate-500">{group.skills.length}</span>
          </div>
        ))}
        {groupedSkills.length > 3 && (
          <div className="flex items-center rounded-full border border-white/10 bg-white/[0.04] px-3 py-1">
            <span className="text-[11px] text-slate-400">+{groupedSkills.length - 3} more</span>
          </div>
        )}
      </div>

      {/* Subtle bar graph */}
      <div className="mt-4 flex items-end gap-1 h-8">
        {groupedSkills.slice(0, 6).map((group, i) => {
          const maxCount = Math.max(...groupedSkills.map(g => g.skills.length));
          const heightPct = maxCount > 0 ? (group.skills.length / maxCount) * 100 : 0;
          return (
            <div
              key={group.title}
              className="flex-1 rounded-sm bg-emerald-500/20 transition-all group-hover:bg-emerald-500/30"
              style={{ height: `${Math.max(15, heightPct)}%` }}
            />
          );
        })}
      </div>

      <p className="mt-3 text-[11px] text-slate-500 group-hover:text-slate-400 transition">
        Click to explore all skill groups in detail →
      </p>
    </motion.button>
  );
}

// ─── NEW: Compact widget for Gaps ────────────────────────────────────────────

function GapsCompactWidget({
  gaps,
  onClick,
}: {
  gaps: Gap[];
  onClick: () => void;
}) {
  const highCount = gaps.filter(g => g.importance === "High").length;
  const modCount  = gaps.filter(g => g.importance === "Moderate").length;
  const lowCount  = gaps.filter(g => g.importance === "Low").length;
  const topThree = gaps.slice(0, 3);

  return (
    <motion.button
      type="button"
      onClick={onClick}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.15 }}
      className="group w-full rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-left transition hover:border-rose-500/25 hover:bg-rose-500/[0.04]"
    >
      {/* Header row */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-rose-500/20 bg-rose-500/10">
            <svg viewBox="0 0 16 16" className="h-4 w-4 text-rose-400" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M8 2v5M8 10.5v.5" strokeLinecap="round"/>
              <path d="M8 14A6 6 0 108 2a6 6 0 000 12z"/>
            </svg>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-rose-400">Priority Gaps</p>
            <p className="text-sm font-semibold text-white">{gaps.length} skill{gaps.length !== 1 ? "s" : ""} to address</p>
          </div>
        </div>
        <span className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-400 transition group-hover:border-rose-500/30 group-hover:text-rose-300">
          →
        </span>
      </div>

      {/* Priority breakdown */}
      <div className="mt-4 grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-2.5 text-center">
          <p className="text-lg font-bold text-rose-300">{highCount}</p>
          <p className="text-[10px] text-rose-400/70 uppercase tracking-wider">High</p>
        </div>
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-2.5 text-center">
          <p className="text-lg font-bold text-amber-300">{modCount}</p>
          <p className="text-[10px] text-amber-400/70 uppercase tracking-wider">Moderate</p>
        </div>
        <div className="rounded-xl border border-sky-500/20 bg-sky-500/10 p-2.5 text-center">
          <p className="text-lg font-bold text-sky-300">{lowCount}</p>
          <p className="text-[10px] text-sky-400/70 uppercase tracking-wider">Low</p>
        </div>
      </div>

      {/* Top gaps preview */}
      <div className="mt-4 space-y-2">
        {topThree.map((gap) => (
          <div key={gap.skill} className="flex items-center justify-between gap-3">
            <span className="text-xs text-slate-300 truncate">{gap.skill}</span>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
              gap.importance === "High" ? "bg-rose-500/15 text-rose-300"
              : gap.importance === "Moderate" ? "bg-amber-500/15 text-amber-300"
              : "bg-sky-500/15 text-sky-300"
            }`}>
              {gap.importance}
            </span>
          </div>
        ))}
        {gaps.length > 3 && (
          <p className="text-[11px] text-slate-500">+{gaps.length - 3} more gaps</p>
        )}
      </div>

      <p className="mt-3 text-[11px] text-slate-500 group-hover:text-slate-400 transition">
        Click to see detailed gap analysis →
      </p>
    </motion.button>
  );
}

// ─── NEW: Full-detail modal for Skills ───────────────────────────────────────

function SkillsDetailModal({
  groupedSkills,
  onClose,
}: {
  groupedSkills: Array<{ title: string; skills: string[] }>;
  onClose: () => void;
}) {
  const maxSkills = groupedSkills.reduce(
    (max, g) => Math.max(max, g.skills.length),
    1
  );

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, y: 22, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 18, scale: 0.98 }}
          transition={{ duration: 0.24 }}
          className="max-h-[88vh] w-full max-w-4xl overflow-y-auto rounded-3xl border border-white/10 bg-slate-950 p-6 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-400/80">
                CV Strengths
              </p>
              <h3 className="mt-2 text-2xl font-semibold text-white">
                Verified skill groups
              </h3>
              <p className="mt-1 text-sm text-slate-400">
                Grouped by domain for faster scanning.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-white transition hover:bg-white/10"
            >
              Close
            </button>
          </div>

          {groupedSkills.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-black/10 p-4 text-sm leading-6 text-slate-300">
              No trustworthy technical strengths were detected from this CV.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {groupedSkills.map((group, index) => (
                <motion.div
                  key={group.title}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, delay: index * 0.03 }}
                  className="rounded-2xl border border-white/10 bg-black/10 p-5"
                >
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <div className="h-2 w-2 rounded-full bg-emerald-400" />
                      <h3 className="text-sm font-semibold text-white">
                        {group.title}
                      </h3>
                    </div>
                    <span className="text-xs text-slate-400">
                      {group.skills.length} skills
                    </span>
                  </div>

                  <div className="mb-4 h-1 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-emerald-500/50"
                      style={{
                        width: `${Math.min(
                          100,
                          (group.skills.length / maxSkills) * 100
                        )}%`,
                      }}
                    />
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {group.skills.map((skill) => (
                      <span
                        key={`${group.title}-${skill}`}
                        className="inline-flex rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[13px] font-medium text-slate-100"
                      >
                        {skill}
                      </span>
                    ))}
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ─── Full-detail modal for Gaps (redesigned) ─────────────────────────────────

function GapsDetailModal({
  gaps,
  onClose,
}: {
  gaps: Gap[];
  onClose: () => void;
}) {
  const highGaps = gaps.filter((g) => g.importance === "High").slice(0, 4);
  const modGaps  = gaps.filter((g) => g.importance === "Moderate").slice(0, 3);
  const total    = gaps.length;
  const highCount = gaps.filter((g) => g.importance === "High").length;
  const modCount  = gaps.filter((g) => g.importance === "Moderate").length;
  const lowCount  = gaps.filter((g) => g.importance === "Low").length;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.97 }}
          transition={{ duration: 0.22 }}
          className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-white/10 bg-slate-950 p-5 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-4 mb-5">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-rose-400/80">Skill Gaps Overview</p>
              <h3 className="mt-1 text-xl font-semibold text-white">What to close next</h3>
              <p className="mt-0.5 text-xs text-slate-400">Recurring gaps across your top role matches, ranked by impact.</p>
            </div>
            <button type="button" onClick={onClose}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-white/10 shrink-0">
              Close
            </button>
          </div>

          {gaps.length === 0 ? (
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-100">
              No major recurring gaps detected — your profile aligns well.
            </div>
          ) : (
            <div className="space-y-4">
              {/* Summary stat row */}
              <div className="grid grid-cols-3 gap-2">
                {[
                  { count: highCount, label: "High priority", color: "border-rose-500/25 bg-rose-500/10 text-rose-300", sub: "text-rose-400/60" },
                  { count: modCount,  label: "Moderate",       color: "border-amber-500/25 bg-amber-500/10 text-amber-300", sub: "text-amber-400/60" },
                  { count: lowCount,  label: "Lower impact",   color: "border-sky-500/25 bg-sky-500/10 text-sky-300", sub: "text-sky-400/60" },
                ].map(({ count, label, color, sub }) => (
                  <div key={label} className={`rounded-xl border p-2.5 text-center ${color}`}>
                    <p className="text-lg font-bold leading-none">{count}</p>
                    <p className={`mt-1 text-[9px] uppercase tracking-wider ${sub}`}>{label}</p>
                  </div>
                ))}
              </div>

              {/* Matched / Missing ratio bar */}
              <div>
                <div className="flex items-center justify-between mb-1.5 text-[10px] text-slate-400">
                  <span>Gap severity distribution</span>
                  <span>{total} total gaps</span>
                </div>
                <div className="h-2 rounded-full bg-white/10 flex overflow-hidden">
                  {highCount > 0 && <div className="h-full bg-rose-500/70 transition-all" style={{ width: `${(highCount / total) * 100}%` }} />}
                  {modCount  > 0 && <div className="h-full bg-amber-500/60 transition-all" style={{ width: `${(modCount / total) * 100}%` }} />}
                  {lowCount  > 0 && <div className="h-full bg-sky-500/40 transition-all"  style={{ width: `${(lowCount / total) * 100}%` }} />}
                </div>
              </div>

              {/* High priority gaps */}
              {highGaps.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-rose-400 mb-2">High Priority</p>
                  <div className="space-y-2">
                    {highGaps.map((gap, i) => (
                      <motion.div key={gap.skill}
                        initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.04 }}
                        className="flex items-center justify-between gap-3 rounded-xl border border-rose-500/20 bg-rose-500/[0.06] px-3.5 py-2.5"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="h-2 w-2 rounded-full bg-rose-400 shrink-0" />
                          <span className="text-sm font-medium text-white truncate">{gap.skill}</span>
                        </div>
                        <div className="flex items-center gap-3 shrink-0 text-xs text-slate-400">
                          <span>Weight <span className="font-semibold text-white">{gap.jobWeight ?? 0}</span></span>
                          <span>You <span className="font-semibold text-white">{gap.userWeight ?? 0}</span></span>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>
              )}

              {/* Medium priority gaps */}
              {modGaps.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-400 mb-2">Medium Priority</p>
                  <div className="space-y-2">
                    {modGaps.map((gap, i) => (
                      <motion.div key={gap.skill}
                        initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: (highGaps.length + i) * 0.04 }}
                        className="flex items-center justify-between gap-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.05] px-3.5 py-2.5"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="h-2 w-2 rounded-full bg-amber-400 shrink-0" />
                          <span className="text-sm font-medium text-white truncate">{gap.skill}</span>
                        </div>
                        <div className="flex items-center gap-3 shrink-0 text-xs text-slate-400">
                          <span>Weight <span className="font-semibold text-white">{gap.jobWeight ?? 0}</span></span>
                          <span>You <span className="font-semibold text-white">{gap.userWeight ?? 0}</span></span>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ─── OverviewHeader (unchanged logic, same visual) ────────────────────────────

function OverviewHeader({ analysis, readinessBand }: { analysis: AnalysisResponse; readinessBand: string }) {
  const sb = analysis.topMatches[0]?.scoreBreakdown;
  const skillStrength = sb ? (sb.semanticMatchPercent + sb.weightedSkillPercent) / 2 : 0;
  const fitAlignment = sb ? (sb.exactOverlapPercent + sb.categoryAlignmentPercent) / 2 : 0;

  return (
    <Panel className="overflow-hidden p-3 md:p-4" delay={0.04}>
      <div className="grid gap-4 xl:grid-cols-[140px_minmax(0,1fr)] xl:items-start">
        <div className="flex items-start justify-center xl:justify-start">
          <ReadinessRing score={analysis.readinessScore} label={readinessBand} />
        </div>
        <div className="space-y-3">
          <div className="min-w-0 space-y-1">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent/80">Readiness snapshot</p>
            <h2 className="text-[1.6rem] font-semibold leading-tight text-white">Profile overview</h2>
          </div>
          {/* 2 combined score boxes */}
          <div className="grid grid-cols-2 gap-3">
            <ScoreBox
              title="Skill Strength"
              iconNode={
                <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" fill="currentColor">
                  <path d="M7 1a3.5 3.5 0 00-2.6 5.8L3 9l1 1 1.4-1.4.6.6A3.5 3.5 0 107 1zm0 5.5a2 2 0 110-4 2 2 0 010 4z" opacity="0.85"/>
                </svg>
              }
              combined={skillStrength}
              subs={[
                { label: "Semantic", value: sb?.semanticMatchPercent ?? 0 },
                { label: "Skills", value: sb?.weightedSkillPercent ?? 0 },
              ]}
            />
            <ScoreBox
              title="Fit Alignment"
              iconNode={
                <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 4l6 3 6-3M1 8l6 3 6-3"/>
                </svg>
              }
              combined={fitAlignment}
              subs={[
                { label: "Overlap", value: sb?.exactOverlapPercent ?? 0 },
                { label: "Category", value: sb?.categoryAlignmentPercent ?? 0 },
              ]}
            />
          </div>
          {/* 3-col insight row */}
          <div className="grid grid-cols-3 gap-2">
            <InsightPill
              label="Best match"
              value={analysis.insightSummary?.bestMatchTitle ?? analysis.topMatches[0]?.title ?? "—"}
              hint={analysis.insightSummary ? `${pct(analysis.insightSummary.bestMatchPercent)} match` : null}
            />
            <InsightPill
              label="Next role"
              value={analysis.nextRole?.stretchRole ?? analysis.nextRole?.currentBestFit ?? "—"}
            />
            <InsightPill
              label="Main gap"
              value={analysis.insightSummary?.mainGap ?? "No critical gap"}
              accent="rose"
            />
          </div>
        </div>
      </div>
    </Panel>
  );
}

// ─── NEW: Action Plan — styled like OverviewHeader ────────────────────────────

function ActionPlanPanel({
  roadmap,
  recommendations,
}: {
  roadmap: LearningRoadmapItem[];
  recommendations: Recommendation[];
}) {
  const topRoadmap = roadmap.slice(0, 3);
  const topRecommendations = recommendations.slice(0, 2);

  // Derive a "highlight" stat for the visual accent
  const firstItem = topRoadmap[0];
  const firstRec = topRecommendations[0];

  return (
    <Panel className="overflow-hidden p-3 md:p-4" delay={0.22}>
      {/* Decorative accent line */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/30 to-transparent" />

      <div className="grid gap-4 xl:grid-cols-[120px_minmax(0,1fr)] xl:items-start">

        {/* LEFT: Visual accent column */}
        <div className="flex flex-col items-center justify-start gap-3 xl:items-start">
          {/* Decorative "compass" icon block */}
          <div className="relative flex h-28 w-28 items-center justify-center md:h-32 md:w-32">
            {/* Outer ring */}
            <svg viewBox="0 0 140 140" className="h-full w-full">
              <circle cx="70" cy="70" r="54" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="10" />
              {/* Dashed inner ring */}
              <circle cx="70" cy="70" r="40" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="1" strokeDasharray="4 6" />
              {/* Accent arc — 60% filled */}
              <motion.circle
                cx="70" cy="70" r="54"
                fill="none" stroke="currentColor"
                strokeWidth="10" strokeLinecap="round"
                className="text-accent"
                initial={{ strokeDashoffset: 2 * Math.PI * 54 }}
                animate={{ strokeDashoffset: 2 * Math.PI * 54 * 0.4 }}
                transition={{ duration: 1.1, ease: "easeOut", delay: 0.3 }}
                strokeDasharray={2 * Math.PI * 54}
                style={{ transformOrigin: "center", transform: "rotate(-90deg)" }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              {/* Compass north arrow */}
              <svg viewBox="0 0 24 24" className="h-8 w-8 text-accent" fill="currentColor">
                <path d="M12 2L8 10h8L12 2z" opacity="0.9"/>
                <path d="M12 22l4-8H8l4 8z" opacity="0.3"/>
              </svg>
              <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-300">Action plan</p>
            </div>
          </div>

          {/* Summary stat pills */}
          <div className="flex flex-col gap-2 w-full">
            <div className="rounded-xl border border-white/10 bg-black/10 px-3 py-2 text-center">
              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-400">Steps</p>
              <p className="mt-0.5 text-xl font-bold text-white">{topRoadmap.length + topRecommendations.length}</p>
            </div>
            <div className="rounded-xl border border-accent/15 bg-accent/[0.07] px-3 py-2 text-center">
              <p className="text-[10px] uppercase tracking-[0.16em] text-accent/70">Focus</p>
              <p className="mt-0.5 text-sm font-semibold text-white truncate">{firstItem?.priority ?? "—"}</p>
            </div>
          </div>
        </div>

        {/* RIGHT: Content */}
        <div className="space-y-3">
          <div className="min-w-0 space-y-0.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-accent/80">What to do next</p>
            <h2 className="text-[1.4rem] font-semibold leading-tight text-white">Your action plan</h2>
          </div>

          {/* Roadmap items */}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {topRoadmap.map((item, index) => (
              <motion.div
                key={`${item.skill}-${index}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.28 + index * 0.06 }}
                className="rounded-2xl border border-white/10 bg-black/10 p-4"
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/20 text-[10px] font-bold text-accent">
                    {index + 1}
                  </span>
                  <span className="rounded-full border border-accent/20 bg-accent/10 px-2.5 py-0.5 text-[10px] font-semibold text-accent">
                    {item.priority}
                  </span>
                </div>
                <h4 className="text-sm font-semibold text-white mt-1">{item.skill}</h4>
                <p className="mt-2 text-xs leading-5 text-slate-400 line-clamp-2">{item.reason}</p>
                {item.estimatedImpact && (
                  <p className="mt-2 text-[10px] uppercase tracking-[0.14em] text-slate-500">{item.estimatedImpact}</p>
                )}
              </motion.div>
            ))}
          </div>

          {/* Recommendations */}
          {topRecommendations.length > 0 && (
            <div className="grid gap-3 md:grid-cols-2">
              {topRecommendations.map((rec, index) => (
                <motion.div
                  key={`${rec.title}-${index}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 + index * 0.06 }}
                  className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-accent/60" />
                    <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400">
                      Recommendation {index + 1}
                    </p>
                  </div>
                  <h4 className="text-sm font-semibold text-white">{rec.title}</h4>
                  <p className="mt-2 text-xs leading-5 text-slate-400 line-clamp-3">{rec.description}</p>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}

// ─── Sidebar: CV Strengths ────────────────────────────────────────────────────
function SkillsSidebarWidget({
  groupedSkills,
  onClick,
}: {
  groupedSkills: Array<{ title: string; skills: string[] }>;
  onClick: () => void;
}) {
  const totalSkills = groupedSkills.reduce((sum, g) => sum + g.skills.length, 0);
  const maxCount = Math.max(...groupedSkills.map((g) => g.skills.length), 1);

  return (
    <motion.button
      type="button"
      onClick={onClick}
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.28, delay: 0.1 }}
      className="group w-full rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 text-left transition hover:border-emerald-500/25 hover:bg-emerald-500/[0.04]"
    >
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-emerald-400">CV Strengths</p>
          <p className="text-xl font-bold text-white leading-none mt-0.5">{totalSkills}
            <span className="text-[11px] font-normal text-slate-400 ml-1">skills</span>
          </p>
        </div>
        <span className="text-slate-500 group-hover:text-emerald-400 transition text-base">→</span>
      </div>

      {/* Domain bars — no scroll, fits entirely */}
      <div className="space-y-1.5">
        {groupedSkills.slice(0, 5).map((group) => {
          const shortTitle = group.title.split(" ").slice(0, 2).join(" ");
          const widthPct = Math.round((group.skills.length / maxCount) * 100);
          return (
            <div key={group.title}>
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[10px] text-slate-400 truncate max-w-[100px]">{shortTitle}</span>
                <span className="text-[10px] font-semibold text-emerald-400 shrink-0">{group.skills.length}</span>
              </div>
              <div className="h-1 rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-emerald-500/40 group-hover:bg-emerald-500/60 transition-all"
                  style={{ width: `${Math.max(15, widthPct)}%` }}
                />
              </div>
            </div>
          );
        })}
        {groupedSkills.length > 5 && (
          <p className="text-[10px] text-slate-500 pt-0.5">+{groupedSkills.length - 5} more domains</p>
        )}
      </div>

      <p className="mt-3 text-[9px] text-slate-600 group-hover:text-emerald-400/50 transition">
        Tap to view all →
      </p>
    </motion.button>
  );
}

// ─── Sidebar: Priority Gaps ───────────────────────────────────────────────────
function GapsSidebarWidget({
  gaps,
  onClick,
}: {
  gaps: Gap[];
  onClick: () => void;
}) {
  const highGaps = gaps.filter((g) => g.importance === "High");
  const modGaps  = gaps.filter((g) => g.importance === "Moderate");
  const total    = gaps.length;
  const matched  = 0; // sidebar doesn't have matched context — show gap ratio

  return (
    <motion.button
      type="button"
      onClick={onClick}
      initial={{ opacity: 0, x: 10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.28, delay: 0.15 }}
      className="group w-full rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 text-left transition hover:border-rose-500/25 hover:bg-rose-500/[0.04]"
    >
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-rose-400">Skill Gaps</p>
          <p className="text-xl font-bold text-white leading-none mt-0.5">{total}
            <span className="text-[11px] font-normal text-slate-400 ml-1">to close</span>
          </p>
        </div>
        <span className="text-slate-500 group-hover:text-rose-400 transition text-base">→</span>
      </div>

      {/* Stacked priority bar */}
      <div className="h-1.5 rounded-full bg-white/10 flex overflow-hidden mb-3">
        {highGaps.length > 0 && (
          <div className="h-full bg-rose-500/70" style={{ width: `${(highGaps.length / total) * 100}%` }} />
        )}
        {modGaps.length > 0 && (
          <div className="h-full bg-amber-500/60" style={{ width: `${(modGaps.length / total) * 100}%` }} />
        )}
        <div className="h-full bg-sky-500/40 flex-1" />
      </div>

      {/* High priority gap names */}
      <div className="space-y-1">
        {highGaps.slice(0, 3).map((gap) => (
          <div key={gap.skill} className="flex items-center gap-1.5">
            <span className="h-1 w-1 rounded-full bg-rose-400 shrink-0" />
            <span className="text-[10px] text-slate-300 truncate">{gap.skill}</span>
          </div>
        ))}
        {modGaps.slice(0, highGaps.length < 2 ? 2 : 1).map((gap) => (
          <div key={gap.skill} className="flex items-center gap-1.5">
            <span className="h-1 w-1 rounded-full bg-amber-400 shrink-0" />
            <span className="text-[10px] text-slate-400 truncate">{gap.skill}</span>
          </div>
        ))}
        {total > 4 && <p className="text-[10px] text-slate-500">+{total - 4} more</p>}
      </div>

      <p className="mt-3 text-[9px] text-slate-600 group-hover:text-rose-400/50 transition">
        Tap to view all →
      </p>
    </motion.button>
  );
}

type SortBy = "match" | "demand" | "salary" | "experience";

const SORT_LABELS: Record<SortBy, string> = {
  match:      "Best Match",
  demand:     "Market Demand",
  salary:     "Salary",
  experience: "Experience Fit",
};

function SortDropdown({ sortBy, onChange }: { sortBy: SortBy; onChange: (v: SortBy) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-white/10"
      >
        <span className="text-slate-500">Sort:</span>
        <span className="text-white">{SORT_LABELS[sortBy]}</span>
        <svg viewBox="0 0 10 6" className={`h-2 w-2 text-slate-400 transition-transform duration-150 ${open ? "rotate-180" : ""}`} fill="currentColor">
          <path d="M0 0l5 6 5-6H0z" />
        </svg>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.1 }}
            className="absolute right-0 top-full z-20 mt-1.5 w-44 overflow-hidden rounded-xl border border-white/10 bg-slate-900 shadow-2xl"
          >
            {(Object.keys(SORT_LABELS) as SortBy[]).map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => { onChange(opt); setOpen(false); }}
                className={`flex w-full items-center justify-between px-3 py-2.5 text-xs transition ${
                  sortBy === opt
                    ? "bg-white/[0.06] font-semibold text-white"
                    : "text-slate-400 hover:bg-white/[0.04] hover:text-white"
                }`}
              >
                {SORT_LABELS[opt]}
                {sortBy === opt && (
                  <svg viewBox="0 0 10 8" className="h-2.5 w-2.5 text-accent" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 4l3 3 5-6" />
                  </svg>
                )}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function ResultsSection({ analysis }: { analysis: AnalysisResponse }) {
  const [selectedJob, setSelectedJob] = useState<JobMatch | null>(null);
  const [visibleCount, setVisibleCount] = useState(4);
  const [sortBy, setSortBy] = useState<SortBy>("match");
  const [showSkillsModal, setShowSkillsModal] = useState(false);
  const [showGapsModal, setShowGapsModal] = useState(false);
  const [sidebarsVisible, setSidebarsVisible] = useState(true);

  const sidebarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => setSidebarsVisible(entry.isIntersecting),
      { threshold: 0.1 }
    );
    if (sidebarRef.current) observer.observe(sidebarRef.current);
    return () => observer.disconnect();
  }, []);

  const groupedSkills = useMemo(
    () => groupDetectedSkills(analysis.extractedSkills ?? []),
    [analysis.extractedSkills],
  );

  const readinessBand =
    analysis.insightSummary?.readinessBand ??
    analysis.readinessBand ??
    "Career readiness";

  const sortedMatches = useMemo(() => {
    const all = [...analysis.topMatches];
    if (sortBy === "demand")     return all.sort((a, b) => (b.demandScore ?? 0) - (a.demandScore ?? 0));
    if (sortBy === "salary")     return all.sort((a, b) => (b.salaryScore ?? 0) - (a.salaryScore ?? 0));
    if (sortBy === "experience") return all.sort((a, b) => (b.experienceAlignmentScore ?? 0) - (a.experienceAlignmentScore ?? 0));
    return all; // "match" = original order
  }, [analysis.topMatches, sortBy]);

  const topMatchesToShow = sortedMatches.slice(0, visibleCount);
  const canExpand = visibleCount < Math.min(sortedMatches.length, 20);
  const canCollapse = visibleCount > 4 && sortedMatches.length > 4;

  function handleSort(next: SortBy) {
    setSortBy(next);
    setVisibleCount(4);
  }

  return (
    <div className="w-full overflow-x-hidden px-1 py-3 md:px-2 md:py-4">
      <div className="space-y-3">

        {/* 1. Overview */}
        <OverviewHeader analysis={analysis} readinessBand={readinessBand} />

        {/* 2. Three-column layout: Skills | Top Matches | Gaps */}
        <div ref={sidebarRef} className="flex gap-3 items-start">

          {/* LEFT sidebar — CV Strengths */}
          <div className="hidden xl:flex w-[168px] shrink-0">
            <SkillsSidebarWidget
              groupedSkills={groupedSkills}
              onClick={() => setShowSkillsModal(true)}
            />
          </div>

          {/* CENTER — Top Matches */}
          <div
            className={`flex-1 min-w-0 transition-all duration-500 ${
              sidebarsVisible ? "" : "xl:max-w-[860px] xl:mx-auto"
            }`}
          >
            <Panel className="overflow-hidden p-3.5 md:p-4">
              {/* Panel header */}
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-accent/80">Top matches</p>
                  <h2 className="text-base font-semibold text-white">Best role matches</h2>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex xl:hidden gap-1.5">
                    <button type="button" onClick={() => setShowSkillsModal(true)}
                      className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-medium text-emerald-300 transition hover:bg-emerald-500/20">
                      Skills ↗
                    </button>
                    <button type="button" onClick={() => setShowGapsModal(true)}
                      className="rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-[10px] font-medium text-rose-300 transition hover:bg-rose-500/20">
                      Gaps ↗
                    </button>
                  </div>
                  <SortDropdown sortBy={sortBy} onChange={handleSort} />
                </div>
              </div>

              {/* Job grid */}
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                {topMatchesToShow.length === 0 ? (
                  <div className="rounded-2xl border border-white/10 bg-black/10 p-5 text-sm leading-6 text-slate-300">
                    No ranked job matches were produced for this run.
                  </div>
                ) : (
                  topMatchesToShow.map((job, index) => (
                    <JobMatchCard key={job.id} job={job} index={index} onOpenInsight={setSelectedJob} />
                  ))
                )}
              </div>

              {/* Show more / fewer */}
              {(canExpand || canCollapse) && (
                <div className="mt-4 flex justify-center">
                  <button
                    type="button"
                    onClick={() => canExpand ? setVisibleCount(20) : setVisibleCount(4)}
                    className="rounded-full border border-white/10 bg-white/5 px-5 py-2 text-sm font-medium text-white transition hover:bg-white/10"
                  >
                    {canExpand
                      ? `Show all ${Math.min(sortedMatches.length, 20)} roles`
                      : "Show fewer roles"}
                  </button>
                </div>
              )}
            </Panel>
          </div>

          {/* RIGHT sidebar — Priority Gaps */}
          <div className="hidden xl:flex w-[168px] shrink-0">
            <GapsSidebarWidget
              gaps={analysis.gaps}
              onClick={() => setShowGapsModal(true)}
            />
          </div>
        </div>

        {/* 3. Action plan */}
        <ActionPlanPanel
          roadmap={analysis.learningRoadmap}
          recommendations={analysis.recommendations}
        />

      </div>

      {/* Modals */}
      <RoleInsightModal job={selectedJob} onClose={() => setSelectedJob(null)} />
      {showSkillsModal && (
        <SkillsDetailModal
          groupedSkills={groupedSkills}
          onClose={() => setShowSkillsModal(false)}
        />
      )}
      {showGapsModal && (
        <GapsDetailModal
          gaps={analysis.gaps}
          onClose={() => setShowGapsModal(false)}
        />
      )}
    </div>
  );
}