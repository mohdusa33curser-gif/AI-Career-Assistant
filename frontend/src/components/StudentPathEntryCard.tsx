import { Link } from "react-router-dom";

export default function StudentPathEntryCard() {
  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 shadow-[0_18px_50px_rgba(0,0,0,0.18)] backdrop-blur-sm md:p-7">
      <div className="flex h-full flex-col">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent/80">
            Student mode
          </p>

          <h2 className="mt-3 text-3xl font-semibold text-white">
            Student Path Explorer
          </h2>

          <p className="mt-4 text-sm leading-7 text-slate-300">
            This mode is for students who are not ready to choose jobs yet.
            Upload your CV and the system will suggest the most suitable path,
            explain why it fits, and show the skills you should learn to grow into it.
          </p>
        </div>

        <div className="mt-6 rounded-2xl border border-white/10 bg-black/10 p-5">
          <p className="text-sm font-medium text-white">Best when you want:</p>

          <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-300">
            <li>• a student-friendly path instead of direct job ranking</li>
            <li>• a learning roadmap for a chosen direction</li>
            <li>• a clearer view of which roles live inside each path</li>
          </ul>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                Best output
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-200">
                Clear path suggestions with learning needs per path.
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                Best use case
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-200">
                Students exploring direction before direct job hunting.
              </p>
            </div>
          </div>

          <Link
            to="/student-path"
            className="mt-5 inline-flex rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:brightness-110"
          >
            Open student path explorer
          </Link>
        </div>
      </div>
    </section>
  );
}