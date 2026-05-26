/** @type {import('next').NextConfig} */
const nextConfig = {
  optimizeFonts: false,
  webpack: (config) => {
    config.resolve.fallback = { fs: false }
    return config
  },
}

module.exports = nextConfig
