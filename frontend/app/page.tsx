import dynamic from 'next/dynamic'
import LandingOverlay from '@/components/LandingOverlay'

const Prism = dynamic(() => import('@/components/Prism'), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-[#03060d]" />,
})

export default function HomePage() {
  return (
    <main className="relative h-screen w-screen overflow-hidden bg-[#03060d]">
      <div style={{ width: '100%', height: '100%', position: 'relative' }}>
        <Prism
          animationType="rotate"
          timeScale={0.5}
          height={3.5}
          baseWidth={5.5}
          scale={3.6}
          hueShift={0}
          colorFrequency={1}
          noise={0.5}
          glow={1}
        />
      </div>
      <LandingOverlay />
    </main>
  )
}
