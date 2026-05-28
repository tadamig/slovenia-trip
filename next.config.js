/** @type {import('next').NextConfig} */
const nextConfig = {
  // Leaflet wymaga wyłączenia SSR dla komponentu mapy
  webpack: (config) => {
    config.resolve.fallback = { fs: false }
    return config
  },
}

module.exports = nextConfig
