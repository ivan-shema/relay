/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // shared workspace package ships TS source; let Next transpile it
  transpilePackages: ["@relay/shared"],
};

export default nextConfig;
