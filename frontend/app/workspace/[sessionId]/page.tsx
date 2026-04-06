import AgentTeamWorkspace from '@/components/AgentTeamWorkspace'

interface WorkspacePageProps {
  params: {
    sessionId: string
  }
}

export default function WorkspacePage({ params }: WorkspacePageProps) {
  return <AgentTeamWorkspace sessionId={params.sessionId} />
}
