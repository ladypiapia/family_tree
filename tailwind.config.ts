import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        warm: {
          50: "#eff6ff",
          100: "#dbeafe",
          200: "#bfdbfe",
          500: "#2563eb",
          700: "#1d4ed8",
        },
        pine: {
          500: "#0ea5e9",
          700: "#0369a1",
        },
      },
      boxShadow: {
        card: "0 10px 30px rgba(37, 99, 235, 0.08)",
      },
    },
  },
  plugins: [],
};

export default config;
