/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { hostname: "images.pexels.com" }
    ],
  },

  async rewrites() {
    return [
      {
        source: "/list/wasm/:path*",
        destination: "/list/wasm/:path*",
      },
    ];
  },
};

export default nextConfig;
