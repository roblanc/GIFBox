import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return {
      fallback: [
        {
          source: "/gifs/:path*",
          destination:
            "https://cdn.jsdelivr.net/gh/roblanc/GIFBox@assets/public/gifs/:path*",
        },
      ],
    };
  },
};

export default nextConfig;
