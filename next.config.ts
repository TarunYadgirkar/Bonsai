import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root so a stray lockfile above the repo can't confuse
  // Turbopack's root inference.
  turbopack: { root: __dirname },
  // The engine ships as TypeScript source; Next compiles it like app code.
  transpilePackages: ['@bonsai/engine'],
};

export default nextConfig;
