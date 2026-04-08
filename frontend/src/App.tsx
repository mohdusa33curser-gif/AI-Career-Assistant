import { Link, Route, Routes, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Home } from "@/pages/Home";
import { Results } from "@/pages/Results";
import StudentPathPage from "@/components/StudentPathPage";

export default function App() {
  const location = useLocation();

  return (
    <div className="min-h-screen bg-surface bg-grid-fade">
      <header className="border-b border-white/5 bg-surface/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center px-4 py-4 sm:px-6">
          <Link to="/" className="group flex items-center gap-2">
            <motion.span
              className="h-2.5 w-2.5 rounded-full bg-accent"
              whileHover={{ scale: 1.2 }}
            />
            <span className="font-display text-3xl font-semibold tracking-tight text-white">
              AI Career Assistant
            </span>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[1800px] px-4 py-10 xl:px-8">
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