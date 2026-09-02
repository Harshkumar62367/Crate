import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output is for the Dockerfile only (self-hosting). It conflicts
  // with Vercel's build-output processing, so it is gated behind DOCKER_BUILD
  // which the Dockerfile sets; Vercel builds the default output.
  output: process.env.DOCKER_BUILD ? "standalone" : undefined,
};

export default nextConfig;
