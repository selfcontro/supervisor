import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Team Orchestrator',
  description: '高保真团队协同控制台',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen antialiased relative">{children}</body>
    </html>
  )
}
