'use client'

import Link from 'next/link'
import { useRef } from 'react'
import TrueFocus from './TrueFocus'
import VariableProximity from './VariableProximity'
import { githubRepoLink } from '@/lib/landingLinks'

export default function LandingOverlay() {
  const containerRef = useRef<HTMLDivElement>(null)
  const linksRef = useRef<HTMLDivElement>(null)

  return (
    <section className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-6">
      <div ref={containerRef} className="pointer-events-auto relative text-center">
        <TrueFocus
          sentence="supervisor"
          manualMode={false}
          blurAmount={0}
          borderColor="#67e8f9"
          glowColor="rgba(103, 232, 249, 0.6)"
          animationDuration={0.8}
          pauseBetweenAnimations={1.6}
          className="landing-true-focus"
        />
        <p className="mt-4 text-sm leading-relaxed text-slate-200">
          A minimal control surface for orchestrating Codex-backed agent workflows in real time.
        </p>
        <div ref={linksRef} className="mt-7 flex flex-col items-center justify-center gap-3">
          <div className="flex items-center justify-center gap-8">
            <Link href="/connect-local-codex" className="text-cyan-200">
              <VariableProximity
                label="Get Start"
                className="text-base tracking-[0.01em]"
                containerRef={linksRef}
                radius={220}
                falloff="linear"
                fromFontVariationSettings="'wght' 320, 'opsz' 12"
                toFontVariationSettings="'wght' 1000, 'opsz' 44"
              />
            </Link>
            <Link href="/learn-more" className="text-slate-100">
              <VariableProximity
                label="Learn More"
                className="text-base tracking-[0.01em]"
                containerRef={linksRef}
                radius={220}
                falloff="linear"
                fromFontVariationSettings="'wght' 320, 'opsz' 12"
                toFontVariationSettings="'wght' 1000, 'opsz' 44"
              />
            </Link>
          </div>

          <a
            href={githubRepoLink.href}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 text-sm text-slate-300 transition-colors hover:text-cyan-200"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-300/70" />
            {githubRepoLink.label}
          </a>
        </div>
      </div>
    </section>
  )
}
