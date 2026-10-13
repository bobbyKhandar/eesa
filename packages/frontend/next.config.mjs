/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: false,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  // Backend source uses Node ESM specifiers (`./file.js`) for `.ts` files.
  // Webpack must follow those the same way `tsc` does, or API routes that
  // import `@/backend/src` fail to compile.
  experimental: {
    extensionAlias: {
      ".js": [".ts", ".tsx", ".js"],
      ".jsx": [".tsx", ".jsx"],
    },
  },
  images: {
    unoptimized: true,
  },
  async redirects() {
    return [
      {
        // Obsolete demo page. Saved analyses are /analysis-report/[id].
        source: "/analyze-report",
        destination: "/ai-analyze",
        permanent: false,
      },
    ]
  },
}

export default nextConfig
