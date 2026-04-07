import { Link, Route, Routes, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/utils/helpers";
import { Home } from "@/pages/Home";
import { Results } from "@/pages/Results";
import StudentPathPage from "@/components/StudentPathPage";

const links = [
  { to: "/", label: "Home" },
  { to: "/student-path", label: "Student Paths" },
  { to: "/results", label: "Results" },
];

function NavPill({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className={cn(
        "rounded-full px-3 py-1.5 text-sm font-medium text-slate-400 transition-colors",
        "hover:bg-white/5 hover:text-white",
      )}
    >
      {label}
    </Link>
  );
}

export default function App() {
  const location = useLocation();

  return (
    <div className="min-h-screen bg-surface bg-grid-fade">
      <header className="border-b border-white/5 bg-surface/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <Link to="/" className="group flex items-center gap-2">
            <motion.span
              className="h-2.5 w-2.5 rounded-full bg-accent"
              whileHover={{ scale: 1.2 }}
            />
            <span className="font-display text-lg font-semibold tracking-tight text-white">
              Career<span className="text-accent">Lens</span>
            </span>
          </Link>

          <nav className="flex gap-1 sm:gap-2">
            {links.map((l) => (
              <NavPill key={l.to} to={l.to} label={l.label} />
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.28 }}
          >
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/student-path" element={<StudentPathPage />} />
              <Route path="/results" element={<Results />} />
            </Routes>
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
} 