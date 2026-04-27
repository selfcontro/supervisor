/** @type {import('next').NextConfig} */
const isProdBuild = process.env.NODE_ENV === 'production'

const nextConfig = {
  reactStrictMode: true,
  // Keep `next dev` and `next build` artifacts separate to avoid `.next` corruption
  // when both commands are run during the same debugging session.
  distDir: isProdBuild ? '.next-build' : '.next',
}

module.exports = nextConfig
