/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: false,
  },
  typescript: {
    ignoreBuildErrors: false,
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
