import { useMemo, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import type { AnalysisResponse, JobMatch, LearningRoadmapItem } from "@/types/api";

type StudentTrack = {
  id: string;
  name: string;
  fitScore: number;
  confidencePercent: number;
  roleTitles: string[];
  matchedSkills: string[];
  gapSkills: string[];
  roadmap: LearningRoadmapItem[];
  summary: string;
};

function pct(value: number): string {
  const safe = Math.max(0, Math.min(100, Number(value || 0)));
  return `${Math.round(safe)}%`;
}

function uniq(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, item) => sum + item, 0) / values.length;
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
      transition={{ duration: 0.3, delay }}
      className={`rounded-3xl border border-white/10 bg-white/[0.03] shadow-[0_18px_50px_rgba(0,0,0,0.18)] backdrop-blur-sm ${className}`}
    >
      {children}
    </motion.section>
  );
}

function TrackCard({
  track,
  selected,
  onClick,
}: {
  track: StudentTrack;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-2xl border p-4 text-left transition ${
        selected
          ? "border-amber-500/40 bg-amber-500/10 shadow-[0_0_0_1px_rgba(245,158,11,0.18)]"
          : "border-white/10 bg-white/[0.02] hover:bg-white/[0.04]"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-white">{track.name}</h3>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-400">{track.summary}</p>
        </div>
        <div className="shrink-0 rounded-xl border border-white/10 bg-black/10 px-3 py-2 text-center">
          <p className="text-[9px] uppercase tracking-wider text-slate-400">Fit</p>
          <p className="text-lg font-bold text-white">{pct(track.fitScore)}</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {track.matchedSkills.slice(0, 4).map((skill) => (
          <span
            key={`${track.id}-m-${skill}`}
            className="inline-flex rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-300"
          >
            {skill}
          </span>
        ))}
        {track.gapSkills.slice(0, 2).map((skill) => (
          <span
            key={`${track.id}-g-${skill}`}
            className="inline-flex rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-medium text-amber-300"
          >
            {skill}
          </span>
        ))}
      </div>
    </button>
  );
}

function buildTracks(analysis: AnalysisResponse): StudentTrack[] {
  const grouped = new Map<string, JobMatch[]>();

  for (const job of analysis.topMatches) {
    const key = String(job.category || "General").trim() || "General";
    const current = grouped.get(key) ?? [];
    current.push(job);
    grouped.set(key, current);
  }

  const primaryPath = analysis.careerPath?.primaryPath ?? null;
  const confidence = Number(analysis.careerPath?.confidencePercent ?? 0);

  const tracks: StudentTrack[] = [...grouped.entries()].map(([category, jobs], index) => {
    const fitScore = average(jobs.map((job) => job.matchPercent));

    const matchedSkills = uniq(
      jobs.flatMap((job) =>
        job.skills
          .filter((skill) => skill.status !== "missing")
          .map((skill) => skill.name),
      ),
    );

    const gapSkills = uniq(
      jobs.flatMap((job) =>
        job.skills
          .filter((skill) => skill.status === "missing" || skill.status === "partial")
          .map((skill) => skill.name),
      ),
    );

    const roadmap = analysis.learningRoadmap.filter((item) =>
      gapSkills.includes(item.skill),
    );

    const roleTitles = uniq(jobs.map((job) => job.title));

    const trackConfidence =
      primaryPath && primaryPath.toLowerCase() === category.toLowerCase()
        ? confidence
        : Math.max(40, Math.round(fitScore - 8));

    let summary = `This path is supported by your current CV evidence and matching roles in ${category}.`;
    if (primaryPath && primaryPath.toLowerCase() === category.toLowerCase()) {
      summary = analysis.careerPath?.summary || summary;
    }

    return {
      id: `${category}-${index}`,
      name: category,
      fitScore,
      confidencePercent: trackConfidence,
      roleTitles,
      matchedSkills,
      gapSkills,
      roadmap: roadmap.slice(0, 4),
      summary,
    };
  });

  return tracks.sort((a, b) => {
    if (primaryPath) {
      const aPrimary = a.name.toLowerCase() === primaryPath.toLowerCase() ? 1 : 0;
      const bPrimary = b.name.toLowerCase() === primaryPath.toLowerCase() ? 1 : 0;
      if (aPrimary !== bPrimary) return bPrimary - aPrimary;
    }
    return b.fitScore - a.fitScore;
  });
}

function PathDetail({ track }: { track: StudentTrack }) {
  return (
    <Panel className="p-5 md:p-6" delay={0.1}>
      {/* Header with fit metrics */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-accent/80">
            Selected track
          </p>
          <h2 className="mt-1.5 text-2xl font-semibold text-white">{track.name}</h2>
          <p className="mt-1.5 max-w-2xl text-sm leading-6 text-slate-300">{track.summary}</p>
        </div>
        <div className="flex shrink-0 gap-3">
          <div className="rounded-xl border border-white/10 bg-black/10 px-4 py-2.5 text-center">
            <p className="text-[10px] uppercase tracking-wider text-slate-400">Path fit</p>
            <p className="mt-0.5 text-xl font-bold text-white">{pct(track.fitScore)}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/10 px-4 py-2.5 text-center">
            <p className="text-[10px] uppercase tracking-wider text-slate-400">Confidence</p>
            <p className="mt-0.5 text-xl font-bold text-white">{pct(track.confidencePercent)}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/10 px-4 py-2.5 text-center">
            <p className="text-[10px] uppercase tracking-wider text-slate-400">Roles</p>
            <p className="mt-0.5 text-xl font-bold text-white">{track.roleTitles.length}</p>
          </div>
        </div>
      </div>

      {/* Main content: 2 columns */}
      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        {/* Aligned strengths */}
        <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
          <p className="text-sm font-semibold text-slate-100">Aligned strengths</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {track.matchedSkills.slice(0, 10).map((skill) => (
              <span
                key={`${track.id}-strong-${skill}`}
                className="inline-flex rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-200"
              >
                {skill}
              </span>
            ))}
          </div>
        </div>

        {/* What to learn next */}
        <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
          <p className="text-sm font-semibold text-slate-100">What to learn next</p>
          {track.roadmap.length === 0 ? (
            <p className="mt-3 text-xs text-slate-400">
              No track-specific roadmap items detected. Reinforce the gaps listed below.
            </p>
          ) : (
            <div className="mt-3 space-y-2.5">
              {track.roadmap.slice(0, 3).map((item, index) => (
                <div
                  key={`${track.id}-roadmap-${item.skill}-${index}`}
                  className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-white">{item.skill}</span>
                    <span className="rounded-full border border-accent/20 bg-accent/10 px-2.5 py-0.5 text-[10px] font-semibold text-accent">
                      {item.priority}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-slate-400">{item.reason}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Bottom: roles + gaps */}
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        {/* Roles */}
        <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
          <p className="text-sm font-semibold text-slate-100">
            Roles in this path{" "}
            <span className="font-normal text-slate-500">({track.roleTitles.length})</span>
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {track.roleTitles.map((role, index) => (
              <span
                key={`${track.id}-role-${role}-${index}`}
                className="inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-200"
              >
                {role}
              </span>
            ))}
          </div>
        </div>

        {/* Skills to close */}
        <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
          <p className="text-sm font-semibold text-slate-100">Skills to close first</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {track.gapSkills.slice(0, 12).map((skill) => (
              <span
                key={`${track.id}-gap-${skill}`}
                className="inline-flex rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-200"
              >
                {skill}
              </span>
            ))}
          </div>
        </div>
      </div>
    </Panel>
  );
}

export default function StudentPathResults({
  analysis,
}: {
  analysis: AnalysisResponse;
}) {
  const tracks = useMemo(() => buildTracks(analysis), [analysis]);

  const initialTrack =
    tracks.find(
      (track) =>
        analysis.careerPath?.primaryPath &&
        track.name.toLowerCase() === analysis.careerPath.primaryPath.toLowerCase(),
    ) ?? tracks[0] ?? null;

  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(
    initialTrack?.id ?? null,
  );

  const selectedTrack =
    tracks.find((track) => track.id === selectedTrackId) ?? initialTrack;

  return (
    <div className="space-y-4">
      {/* Compact metrics strip */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28 }}
        className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-3"
      >
        {[
          { label: "Primary path", value: analysis.careerPath?.primaryPath ?? "Unknown" },
          { label: "Confidence", value: pct(analysis.careerPath?.confidencePercent ?? 0) },
          { label: "Entry role", value: analysis.nextRole?.currentBestFit ?? "Unknown" },
          { label: "Main gap", value: analysis.insightSummary?.mainGap ?? "—" },
        ].map((stat, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-xs text-slate-500">{stat.label}:</span>
            <span className="text-sm font-semibold text-white">{stat.value}</span>
          </div>
        ))}
      </motion.div>

      {/* Track selector + detail */}
      <div className="grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
        <Panel className="h-fit p-5" delay={0.06}>
          <div className="space-y-1">
            <h2 className="text-xl font-semibold text-white">Recommended paths</h2>
            <p className="text-xs text-slate-400">Select a path to inspect it in detail.</p>
          </div>

          {tracks.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-white/10 bg-black/10 p-4 text-sm leading-6 text-slate-300">
              No path suggestions were produced from this CV.
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {tracks.map((track) => (
                <TrackCard
                  key={track.id}
                  track={track}
                  selected={selectedTrack?.id === track.id}
                  onClick={() => setSelectedTrackId(track.id)}
                />
              ))}
            </div>
          )}
        </Panel>

        {selectedTrack ? <PathDetail track={selectedTrack} /> : null}
      </div>
    </div>
  );
}
