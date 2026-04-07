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
    <div className="space-y-2">
      {eyebrow ? (
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent/80">
          {eyebrow}
        </p>
      ) : null}
      <h2 className="text-2xl font-semibold text-white md:text-3xl">{title}</h2>
      {subtitle ? (
        <p className="max-w-3xl text-sm leading-7 text-slate-300">{subtitle}</p>
      ) : null}
    </div>
  );
}

function MetricTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string | null;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{label}</p>
      <p className="mt-2 text-lg font-semibold text-white leading-snug">{value}</p>
      {hint ? <p className="mt-2 text-sm leading-6 text-slate-300">{hint}</p> : null}
    </div>
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
      className={`w-full rounded-3xl border p-5 text-left transition ${
        selected
          ? "border-accent/40 bg-accent/10 shadow-[0_0_0_1px_rgba(56,189,248,0.18)]"
          : "border-white/10 bg-white/[0.03] hover:bg-white/[0.05]"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent/80">
            Track
          </p>
          <h3 className="mt-2 text-xl font-semibold text-white">{track.name}</h3>
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/10 px-4 py-3 text-center">
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Fit</p>
          <p className="mt-1 text-2xl font-bold text-white">{pct(track.fitScore)}</p>
        </div>
      </div>

      <p className="mt-4 text-sm leading-6 text-slate-300">{track.summary}</p>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Aligned strengths</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {track.matchedSkills.slice(0, 4).map((skill) => (
              <span
                key={`${track.id}-match-${skill}`}
                className="inline-flex rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-200"
              >
                {skill}
              </span>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Main learning needs</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {track.gapSkills.slice(0, 4).map((skill) => (
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

function PathDetail({
  track,
}: {
  track: StudentTrack;
}) {
  return (
    <Panel className="p-5 md:p-6" delay={0.12}>
      <SectionHeading
        eyebrow="Selected track"
        title={`${track.name} path explorer`}
        subtitle="Where you fit in this path, what roles live inside it, and what to learn next."
      />

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricTile
          label="Path fit"
          value={pct(track.fitScore)}
          hint="Estimated fit from your current CV evidence."
        />
        <MetricTile
          label="Confidence"
          value={pct(track.confidencePercent)}
          hint="How strongly the system sees this path as suitable."
        />
        <MetricTile
          label="Roles in this path"
          value={String(track.roleTitles.length)}
          hint="Example roles aligned with this direction."
        />
        <MetricTile
          label="Learning needs"
          value={String(track.gapSkills.length)}
          hint="Skills that would unlock stronger readiness."
        />
      </div>

      <div className="mt-8 grid gap-6 xl:grid-cols-[1fr_1fr]">
        <div className="rounded-2xl border border-white/10 bg-black/10 p-5">
          <h3 className="text-lg font-semibold text-white">Why this path fits you</h3>
          <p className="mt-3 text-sm leading-7 text-slate-300">{track.summary}</p>

          <div className="mt-5">
            <p className="text-sm font-medium text-slate-200">Existing aligned strengths</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {track.matchedSkills.slice(0, 8).map((skill) => (
                <span
                  key={`${track.id}-strong-${skill}`}
                  className="inline-flex rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-sm font-medium text-emerald-200"
                >
                  {skill}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/10 p-5">
          <h3 className="text-lg font-semibold text-white">What you should learn next</h3>

          {track.roadmap.length === 0 ? (
            <p className="mt-4 text-sm leading-7 text-slate-300">
              No track-specific roadmap items were detected yet. Start by reinforcing the gaps below.
            </p>
          ) : (
            <div className="mt-4 space-y-4">
              {track.roadmap.map((item, index) => (
                <div
                  key={`${track.id}-roadmap-${item.skill}-${index}`}
                  className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <h4 className="text-base font-semibold text-white">{item.skill}</h4>
                    <span className="rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">
                      {item.priority}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-300">{item.reason}</p>
                  <p className="mt-2 text-xs uppercase tracking-[0.16em] text-slate-400">
                    {item.estimatedImpact}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-8 grid gap-6 xl:grid-cols-[1fr_1fr]">
        <div className="rounded-2xl border border-white/10 bg-black/10 p-5">
          <h3 className="text-lg font-semibold text-white">Roles this path can grow into</h3>
          <div className="mt-4 grid gap-3">
            {track.roleTitles.map((role, index) => (
              <div
                key={`${track.id}-role-${role}-${index}`}
                className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-medium text-slate-100"
              >
                {role}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/10 p-5">
          <h3 className="text-lg font-semibold text-white">Skills to close first</h3>
          <div className="mt-4 flex flex-wrap gap-2">
            {track.gapSkills.slice(0, 10).map((skill) => (
              <span
                key={`${track.id}-skill-gap-${skill}`}
                className="inline-flex rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-sm font-medium text-amber-200"
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
    <div className="space-y-6">
      <Panel className="p-5 md:p-6" delay={0.02}>
        <SectionHeading
          eyebrow="Student path overview"
          title="Choose a path before you choose a job"
          subtitle="This interface is built for students. Instead of ranking jobs first, it turns your CV into possible directions, then shows what to learn to move into each path."
        />

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricTile
            label="Primary path"
            value={analysis.careerPath?.primaryPath ?? "Unknown"}
            hint={analysis.careerPath?.summary ?? null}
          />
          <MetricTile
            label="Confidence"
            value={pct(analysis.careerPath?.confidencePercent ?? 0)}
            hint="How strongly your current CV supports this direction."
          />
          <MetricTile
            label="Suggested entry role"
            value={analysis.nextRole?.currentBestFit ?? "Unknown"}
            hint="A realistic first role related to your current profile."
          />
          <MetricTile
            label="Main gap"
            value={analysis.insightSummary?.mainGap ?? "No major gap"}
            hint="The most repeated weakness across your strongest matching directions."
          />
        </div>
      </Panel>

      <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
        <Panel className="h-fit p-5 md:p-6" delay={0.08}>
          <SectionHeading
            eyebrow="Available paths"
            title="Recommended paths"
            subtitle="Select a path to inspect it in detail."
          />

          {tracks.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-white/10 bg-black/10 p-5 text-sm leading-6 text-slate-300">
              No path suggestions were produced from this CV.
            </div>
          ) : (
            <div className="mt-6 grid gap-4">
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