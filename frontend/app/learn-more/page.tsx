import Link from 'next/link'

export default function LearnMorePage() {
  return (
    <main className="min-h-screen bg-[#050912] px-6 py-20 text-slate-100">
      <div className="mx-auto w-full max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight">About Supervisor</h1>
        <p className="mt-4 text-sm leading-7 text-slate-300">
          Supervisor is a graph-first interface for running and observing Codex-backed agent teams. It connects to
          your backend session runtime and visualizes task execution, agent relationships, and logs in one workspace.
        </p>
        <div className="mt-8 flex gap-4 text-sm font-medium">
          <Link href="/workspace/default" className="text-cyan-200 underline-offset-4 hover:underline">
            Go To Workspace
          </Link>
          <Link href="/" className="text-slate-100 underline-offset-4 hover:underline">
            Back Home
          </Link>
        </div>
      </div>
    </main>
  )
}
