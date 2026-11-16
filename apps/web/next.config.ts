import type { NextConfig } from "next";

const apiOrigin = process.env.API_ORIGIN ?? "http://127.0.0.1:8300";

const nextConfig: NextConfig = {
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // In production Caddy sends /api/* to the Go API. During development Next.js proxies it instead.
  async rewrites() {
    if (process.env.NODE_ENV !== "development") {
      return [];
    }

    return [{ source: "/api/:path*", destination: `${apiOrigin}/api/:path*` }];
  },
};

export default nextConfig;
