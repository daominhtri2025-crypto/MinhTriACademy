import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eefaf1", 100: "#d7f2de", 200: "#b0e4bf", 300: "#7dcf96",
          400: "#4bb56c", 500: "#2a9b4d", 600: "#1f8b3f", 700: "#196f33",
          800: "#165829", 900: "#134824",
        },
        sun: { 400: "#ffc83d", 500: "#f5b014" },
      },
      fontFamily: { sans: ["var(--font-sans)", "system-ui", "sans-serif"] },
      keyframes: {
        pop: { "0%": { transform: "scale(.8)", opacity: "0" }, "100%": { transform: "scale(1)", opacity: "1" } },
      },
      animation: { pop: "pop .25s ease-out" },
    },
  },
  plugins: [],
};
export default config;
