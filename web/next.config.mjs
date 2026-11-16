import { fileURLToPath } from "node:url";

/** @type {import("next").NextConfig} */
const config = {
  devIndicators: false,
  distDir: process.env.BROWSER_DIST_DIR || ".next",
  turbopack: {
    root: fileURLToPath(new URL(".", import.meta.url)),
  },
};

export default config;
