import type { NextConfig } from "next";

// BACKEND_URL may be a full URL, a private-network host:port (archmind-api:10000 -> http), or a bare public
// hostname as Render injects it (archmind-api.onrender.com -> https).
const RAW_BACKEND = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";
const BACKEND = RAW_BACKEND.includes("://") ? RAW_BACKEND : /:\d+$/.test(RAW_BACKEND) ? `http://${RAW_BACKEND}` : `https://${RAW_BACKEND}`;

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
