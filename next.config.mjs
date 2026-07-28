/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Next 14: still under experimental. Top-level key `serverExternalPackages`
  // was only promoted in Next 15.
  experimental: {
    serverComponentsExternalPackages: ["@prisma/client", "ioredis", "bcryptjs"],
  },
};

export default nextConfig;