import AgentTeamWorkspace from '@/components/AgentTeamWorkspace'

export const dynamic = 'force-dynamic'

interface WorkspacePageProps {
  params: {
    sessionId: string
  }
}

export default function WorkspacePage({ params }: WorkspacePageProps) {
  return <AgentTeamWorkspace sessionId={params.sessionId} />
}
