import Link from 'next/link'

const highlights = [
  {
    title: 'Session-scoped control',
    description: 'Every URL maps to a live backend session, so orchestration, logs, and task state stay aligned.',
  },
  {
    title: 'Realtime team visibility',
    description: 'Planner, executor, and reviewer status update in one operational surface instead of scattered panels.',
  },
  {
    title: 'Fast handoff into action',
    description: 'Start from the default workspace immediately, then move across sessions without losing operational context.',
  },
]

const stats = [
  { value: '3', label: 'Core agents online' },
  { value: '4', label: 'Realtime event streams' },
  { value: '1', label: 'Workspace to operate' },
]

export default function HomePage() {
  return (
    <main className="landing-shell min-h-screen px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-10">
      <div className="mx-auto flex max-w-[1720px] flex-col gap-8">
        <section className="panel fade-up overflow-hidden rounded-[2.6rem] px-6 py-8 sm:px-8 sm:py-10 lg:px-12 lg:py-14 xl:px-14 xl:py-16">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1.18fr)_500px] lg:items-end xl:gap-14">
            <div>
              <p className="kicker">Agent-Team Orchestration</p>
              <h1 className="editorial-display mt-6 max-w-4xl text-4xl text-[var(--ink)] sm:text-5xl lg:text-6xl xl:text-[4.4rem]">
                <span className="block">Coordinate every agent</span>
                <span className="mt-1 block text-[#bfe8ff]">from one elegant control room.</span>
              </h1>
              <p className="mt-6 max-w-3xl text-base leading-8 text-[var(--ink-soft)] sm:text-lg sm:leading-9">
                Plan, execute, review, and monitor in a single realtime surface. Start with one session and keep full
                operational clarity as work evolves.
              </p>

              <div className="mt-10 flex flex-wrap items-center gap-4">
                <Link href="/workspace/default" className="lavender-button">
                  Get Started
                </Link>
                <a href="#capabilities" className="btn-secondary">
                  Explore Capabilities
                </a>
              </div>
            </div>

            <div className="dark-stage fade-up rounded-[2.2rem] p-6 [animation-delay:0.08s] sm:p-7 lg:p-8">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="section-title">Live Surface</p>
                  <h2 className="mt-2 text-2xl font-semibold text-[var(--ink)]">Default Session</h2>
                </div>
                <span className="soft-pill">Ready</span>
              </div>

              <div className="mt-8 grid gap-4 sm:grid-cols-3">
                {stats.map((stat) => (
                  <article key={stat.label} className="rounded-[1.6rem] border border-[var(--line)] bg-[rgba(15,23,42,0.44)] px-4 py-4">
                    <p className="text-3xl font-semibold text-[var(--ink)]">{stat.value}</p>
                    <p className="mt-2 text-sm text-[var(--ink-soft)]">{stat.label}</p>
                  </article>
                ))}
              </div>

              <div className="mt-8 rounded-[1.8rem] border border-[var(--line)] bg-[rgba(15,23,42,0.44)] p-5">
                <p className="section-title">What Opens Next</p>
                <ul className="mt-3 space-y-3 text-sm leading-7 text-[var(--ink-soft)]">
                  <li>Session list from `GET /api/sessions`</li>
                  <li>Snapshot hydrate from `GET /api/sessions/:sessionId`</li>
                  <li>Live updates for `agent_status`, `task_update`, `task:new`, and `log_entry`</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        <section id="capabilities" className="grid gap-6 lg:grid-cols-3 xl:gap-8">
          {highlights.map((item, index) => (
            <article
              key={item.title}
              className="panel-strong fade-up rounded-[2rem] p-6 sm:p-7"
              style={{ animationDelay: `${0.12 + index * 0.06}s` }}
            >
              <p className="section-title">Capability {index + 1}</p>
              <h2 className="mt-3 text-2xl font-semibold text-[var(--ink)]">{item.title}</h2>
              <p className="mt-3 text-sm leading-7 text-[var(--ink-soft)] sm:text-base">{item.description}</p>
            </article>
          ))}
        </section>
      </div>
    </main>
  )
}
