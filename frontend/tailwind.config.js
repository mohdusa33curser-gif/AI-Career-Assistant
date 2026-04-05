/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: "#0f1419",
          card: "#161d27",
          elevated: "#1c2633",
        },
        accent: {
          DEFAULT: "#38bdf8",
          dim: "#0ea5e9",
        },
        match: {
          DEFAULT: "#22c55e",
          muted: "#166534",
        },
        miss: {
          DEFAULT: "#ef4444",
          muted: "#7f1d1d",
        },
        partial: {
          DEFAULT: "#eab308",
          muted: "#854d0e",
        },
      },
      fontFamily: {
        sans: ["DM Sans", "system-ui", "sans-serif"],
        display: ["Outfit", "system-ui", "sans-serif"],
      },
      backgroundImage: {
        "grid-fade":
          "linear-gradient(to bottom, rgba(15,20,25,0.3), rgba(15,20,25,1)), radial-gradient(ellipse 80% 50% at 50% -20%, rgba(56,189,248,0.18), transparent)",
      },
    },
  },
  plugins: [],
};
