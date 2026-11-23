import process from "node:process";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  ...(process.env.VAULTFS_TEST_WEB === '1' && { distDir: '.next/vaultfs-test' }),
  devIndicators: false,
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'" },
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
      ],
    }];
  },
};

export default nextConfig;
