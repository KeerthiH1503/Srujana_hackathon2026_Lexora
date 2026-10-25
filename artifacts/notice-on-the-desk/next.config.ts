import type { NextConfig } from "next";

const rawBasePath = process.env.BASE_PATH;
const basePath =
  rawBasePath && rawBasePath !== "/"
    ? rawBasePath.replace(/\/$/, "")
    : undefined;

const nextConfig: NextConfig = {
  basePath,
  env: { NEXT_PUBLIC_BASE_PATH: basePath ?? "" },
  output: "export",
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
