'use client'

import Link from 'next/link'
import { useRef } from 'react'
import TrueFocus from './TrueFocus'
import VariableProximity from './VariableProximity'

export default function LandingOverlay() {
  const containerRef = useRef<HTMLDivElement>(null)

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
        <div className="mt-7 flex items-center justify-center gap-6 text-sm">
          <Link href="/workspace/default" className="text-cyan-200">
            <VariableProximity
              label="Get Start"
              containerRef={containerRef}
              radius={110}
              falloff="gaussian"
              fromFontVariationSettings="'wght' 420, 'opsz' 14"
              toFontVariationSettings="'wght' 980, 'opsz' 42"
            />
          </Link>
          <Link href="/learn-more" className="text-slate-100">
            <VariableProximity
              label="Learn More"
              containerRef={containerRef}
              radius={110}
              falloff="gaussian"
              fromFontVariationSettings="'wght' 420, 'opsz' 14"
              toFontVariationSettings="'wght' 980, 'opsz' 42"
            />
          </Link>
        </div>
      </div>
    </section>
  )
}
