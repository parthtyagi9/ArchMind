import type { NextConfig } from "next";

const BACKEND = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" },
    },
  },
  // Same-origin proxy to FastAPI so the httpOnly session cookie works without CORS.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${BACKEND}/api/:path*` }];
  },
  // Agent runs make several LLM calls; allow long proxied requests.
  experimental: { proxyTimeout: 180_000 },
};

export default nextConfig;
