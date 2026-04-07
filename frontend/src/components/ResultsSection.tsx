import { useMemo, useState, type ReactNode } from "react";
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

function BreakdownBar({ label, value }: { label: string; value: number }) {
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
          className="h-full rounded-full bg-accent"
        />
      </div>
    </div>
  );
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
  const matched = job.skills.filter((s) => s.status === "matched");
  const partial = job.skills.filter((s) => s.status === "partial");
  const missing = job.skills.filter((s) => s.status === "missing");
  const whyThisRole = job.whyThisRole.length > 0 ? job.whyThisRole : buildAcceptanceSignals(job);
  const rejectionSignals = buildRejectionSignals(job);
  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      >
        <motion.div
          initial={{ opacity: 0, y: 22, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 18, scale: 0.98 }}
          transition={{ duration: 0.24 }}
          className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-3xl border border-white/10 bg-slate-950 p-6 shadow-2xl"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-accent/80">Role recommendation</p>
              <h3 className="mt-2 text-2xl font-semibold text-white">{job.title}</h3>
              <p className="mt-2 text-sm text-slate-300">{job.category} • {pct(job.matchPercent)} match</p>
            </div>
            <button type="button" onClick={onClose} className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-white transition hover:bg-white/10">Close</button>
          </div>
          <div className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="space-y-6">
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <h4 className="text-lg font-semibold text-white">Why you are a fit</h4>
                <ul className="mt-4 space-y-3 text-sm leading-6 text-slate-300">
                  {whyThisRole.map((line, index) => (
                    <li key={`fit-${index}`} className="flex gap-3">
                      <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-400" />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <h4 className="text-lg font-semibold text-white">Why you may be rejected</h4>
                <ul className="mt-4 space-y-3 text-sm leading-6 text-slate-300">
                  {rejectionSignals.map((line, index) => (
                    <li key={`risk-${index}`} className="flex gap-3">
                      <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-rose-400" />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="space-y-6">
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <h4 className="text-lg font-semibold text-white">Score breakdown</h4>
                <div className="mt-5 space-y-4">
                  <BreakdownBar label="Semantic fit" value={job.scoreBreakdown.semanticMatchPercent} />
                  <BreakdownBar label="Skill coverage" value={job.scoreBreakdown.weightedSkillPercent} />
                  <BreakdownBar label="Exact overlap" value={job.scoreBreakdown.exactOverlapPercent} />
                  <BreakdownBar label="Category alignment" value={job.scoreBreakdown.categoryAlignmentPercent} />
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <h4 className="text-lg font-semibold text-white">Skill evidence</h4>
                <div className="mt-5 space-y-5">
                  <SkillGroup title="Strong match" skills={matched} />
                  <SkillGroup title="Needs strengthening" skills={partial} />
                  <SkillGroup title="Missing" skills={missing} />
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function JobMatchCard({ job, index, onOpenInsight }: { job: JobMatch; index: number; onOpenInsight: (job: JobMatch) => void }) {
  const matched = job.skills.filter((s) => s.status === "matched");
  const partial = job.skills.filter((s) => s.status === "partial");
  const missing = job.skills.filter((s) => s.status === "missing");
  return (
    <motion.article
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
      className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 shadow-[0_18px_50px_rgba(0,0,0,0.16)]"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <span className="inline-flex rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-accent">{job.category}</span>
          <h3 className="mt-3 text-2xl font-semibold text-white leading-snug">{job.title}</h3>
        </div>
        <div className="min-w-[110px] rounded-2xl border border-white/10 bg-black/10 px-4 py-3 text-center">
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Match</p>
          <p className="mt-1 text-3xl font-bold text-white">{pct(job.matchPercent)}</p>
        </div>
      </div>
      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Semantic</p>
          <p className="mt-2 text-xl font-semibold text-white">{pct(job.scoreBreakdown.semanticMatchPercent)}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Skill coverage</p>
          <p className="mt-2 text-xl font-semibold text-white">{pct(job.scoreBreakdown.weightedSkillPercent)}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Exact overlap</p>
          <p className="mt-2 text-xl font-semibold text-white">{pct(job.scoreBreakdown.exactOverlapPercent)}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Category fit</p>
          <p className="mt-2 text-xl font-semibold text-white">{pct(job.scoreBreakdown.categoryAlignmentPercent)}</p>
        </div>
      </div>
      <div className="mt-6 space-y-5">
        <SkillGroup title="Strong match" skills={matched} />
        <SkillGroup title="Needs strengthening" skills={partial} />
        <SkillGroup title="Missing" skills={missing} />
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-5">
        <p className="text-sm text-slate-300">This role is explained through a detailed recommendation panel instead of repeating generic missing-skill text.</p>
        <button type="button" onClick={() => onOpenInsight(job)} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-accent/20 text-xs text-accent">i</span>
          View recommendation
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
  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, y: 22, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 18, scale: 0.98 }}
          transition={{ duration: 0.24 }}
          className="max-h-[88vh] w-full max-w-3xl overflow-y-auto rounded-3xl border border-white/10 bg-slate-950 p-6 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-4 mb-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-400/80">CV Strengths</p>
              <h3 className="mt-2 text-2xl font-semibold text-white">Verified skill groups</h3>
              <p className="mt-1 text-sm text-slate-400">Grouped by domain for faster scanning.</p>
            </div>
            <button type="button" onClick={onClose} className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-white transition hover:bg-white/10">Close</button>
          </div>

          {groupedSkills.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-black/10 p-4 text-sm leading-6 text-slate-300">
              No trustworthy technical strengths were detected from this CV.
            </div>
          ) : (
            <div className="space-y-3">
              {groupedSkills.map((group, index) => (
                <motion.div
                  key={group.title}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.24, delay: index * 0.03 }}
                  className="rounded-2xl border border-white/10 bg-black/10 p-4"
                >
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-white">{group.title}</h3>
                    <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-slate-300">{group.skills.length}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {group.skills.map((skill) => (
                      <span key={`${group.title}-${skill}`} className="inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-100">
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

// ─── NEW: Full-detail modal for Gaps ─────────────────────────────────────────

function GapsDetailModal({
  gaps,
  onClose,
}: {
  gaps: Gap[];
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, y: 22, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 18, scale: 0.98 }}
          transition={{ duration: 0.24 }}
          className="max-h-[88vh] w-full max-w-3xl overflow-y-auto rounded-3xl border border-white/10 bg-slate-950 p-6 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-4 mb-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-rose-400/80">Priority Gaps</p>
              <h3 className="mt-2 text-2xl font-semibold text-white">What blocks stronger matches</h3>
              <p className="mt-1 text-sm text-slate-400">Recurring weaknesses with the highest role impact.</p>
            </div>
            <button type="button" onClick={onClose} className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-white transition hover:bg-white/10">Close</button>
          </div>

          {gaps.length === 0 ? (
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm leading-6 text-emerald-100">
              No major recurring gaps were detected in your strongest role matches.
            </div>
          ) : (
            <div className="space-y-3">
              {gaps.slice(0, 5).map((gap, index) => (
                <GapCard key={`${gap.skill}-${index}`} gap={gap} index={index} />
              ))}
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ─── OverviewHeader (unchanged logic, same visual) ────────────────────────────

function OverviewHeader({ analysis, readinessBand }: { analysis: AnalysisResponse; readinessBand: string }) {
  return (
    <Panel className="overflow-hidden p-4 md:p-[18px]" delay={0.04}>
      <div className="grid gap-3 xl:grid-cols-[160px_minmax(0,1fr)] xl:items-start">
        <div className="flex items-start justify-center xl:justify-start">
          <ReadinessRing score={analysis.readinessScore} label={readinessBand} />
        </div>
        <div className="space-y-3">
          <div className="min-w-0 space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent/80">Readiness snapshot</p>
            <h2 className="text-[1.95rem] font-semibold leading-tight text-white">Profile overview</h2>
            <p className="max-w-4xl text-sm leading-6 text-slate-300">A compact summary of your strongest direction, best current fit, next likely target, and highest recurring gap.</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <MetricTile
              label="Best match"
              value={analysis.insightSummary?.bestMatchTitle ?? analysis.topMatches[0]?.title ?? "Unknown"}
              hint={analysis.insightSummary ? `${pct(analysis.insightSummary.bestMatchPercent)} match` : null}
            />
            <MetricTile
              label="Strongest direction"
              value={analysis.careerPath?.primaryPath ?? analysis.insightSummary?.strongestCategory ?? "Unknown"}
              hint={analysis.careerPath?.summary ?? null}
            />
            <MetricTile
              label="Next role"
              value={analysis.nextRole?.stretchRole ?? analysis.nextRole?.currentBestFit ?? "Unknown"}
              hint={analysis.nextRole?.summary ?? null}
            />
            <MetricTile
              label="Main gap"
              value={analysis.insightSummary?.mainGap ?? "No critical gap detected"}
              hint="Highest recurring weakness across your strongest matches."
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
    <Panel className="overflow-hidden p-4 md:p-[18px]" delay={0.22}>
      {/* Decorative accent line */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/30 to-transparent" />

      <div className="grid gap-6 xl:grid-cols-[160px_minmax(0,1fr)] xl:items-start">

        {/* LEFT: Visual accent column */}
        <div className="flex flex-col items-center justify-start gap-4 xl:items-start">
          {/* Decorative "compass" icon block */}
          <div className="relative flex h-36 w-36 items-center justify-center md:h-40 md:w-40">
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
        <div className="space-y-4">
          <div className="min-w-0 space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent/80">What to do next</p>
            <h2 className="text-[1.95rem] font-semibold leading-tight text-white">Your action plan</h2>
            <p className="max-w-4xl text-sm leading-6 text-slate-300">
              A compact roadmap based on your strongest direction and highest-impact skill gaps.
            </p>
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

// ─── Main export ──────────────────────────────────────────────────────────────

export function ResultsSection({ analysis }: { analysis: AnalysisResponse }) {
  const [selectedJob, setSelectedJob] = useState<JobMatch | null>(null);
  const [showAllMatches, setShowAllMatches] = useState(false);
  const [showSkillsModal, setShowSkillsModal] = useState(false);
  const [showGapsModal, setShowGapsModal]   = useState(false);

  const groupedSkills = useMemo(
    () => groupDetectedSkills(analysis.extractedSkills ?? []),
    [analysis.extractedSkills],
  );

  const readinessBand =
    analysis.insightSummary?.readinessBand ??
    analysis.readinessBand ??
    "Career readiness";

  const topMatchesToShow = showAllMatches
    ? analysis.topMatches
    : analysis.topMatches.slice(0, 3);

  return (
    <div className="w-full overflow-x-hidden px-1 py-3 md:px-2 md:py-4">
      <div className="space-y-3">

        {/* 1. Profile overview — TOP, no analysisMessage before it */}
        <OverviewHeader analysis={analysis} readinessBand={readinessBand} />

        {/* 2. Compact widgets row: Skills + Gaps side by side */}
        <div className="grid gap-3 md:grid-cols-2">
          <SkillsCompactWidget
            groupedSkills={groupedSkills}
            onClick={() => setShowSkillsModal(true)}
          />
          <GapsCompactWidget
            gaps={analysis.gaps}
            onClick={() => setShowGapsModal(true)}
          />
        </div>

        {/* 3. Top matches — unchanged */}
        <Panel className="overflow-hidden p-4 md:p-5" delay={0.08}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0 flex-1">
              <SectionHeading
                eyebrow="Top matches"
                title="Best role matches"
                subtitle="The matching engine remains the core of the product, so the best-fitting roles appear first and take the main visual focus."
              />
            </div>
            {analysis.topMatches.length > 3 ? (
              <button
                type="button"
                onClick={() => setShowAllMatches((prev) => !prev)}
                className="shrink-0 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10"
              >
                {showAllMatches ? "Show fewer roles" : `Show all ${analysis.topMatches.length} roles`}
              </button>
            ) : null}
          </div>
          <div className="mt-5 grid gap-5">
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
        </Panel>

        {/* 4. Action plan — last, styled like OverviewHeader */}
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