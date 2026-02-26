import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        warm: {
          50: "#fff8ef",
          100: "#feedd7",
          200: "#fbd7ae",
          500: "#db7b2d",
          700: "#9a4a1d",
        },
        pine: {
          500: "#167a6e",
          700: "#0d4f48",
        },
      },
      boxShadow: {
        card: "0 10px 30px rgba(125, 74, 26, 0.08)",
      },
    },
  },
  plugins: [],
};

export default config;
