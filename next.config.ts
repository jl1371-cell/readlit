import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A second dev server (the mock-AI one) builds into its own folder so both can run side by side.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // The development badge sits over the reader's corner; the app has its own status surfaces.
  devIndicators: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
