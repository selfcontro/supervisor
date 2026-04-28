/** @type {import('next').NextConfig} */
const useIsolatedDistDir = process.env.NEXT_DIST_DIR === '.next-build'

const nextConfig = {
  reactStrictMode: true,
  // Keep default `.next` for deployment platforms (Vercel expects it unless configured).
  // Optional local debugging override:
  // NEXT_DIST_DIR=.next-build npm run build
  ...(useIsolatedDistDir ? { distDir: '.next-build' } : {}),
}

module.exports = nextConfig
