import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Set NEXT_PUBLIC_BASE_PATH (e.g. "/moknowledge") at build time to serve the
  // app under a sub-path. Raw URLs that Next can't rewrite use lib/base-path.ts.
  basePath: (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, ""),
};

export default nextConfig;
