function getConnectCopy() {
  return {
    badge: 'Connect Local Codex',
    title: 'Use your own local Codex runtime from the Vercel frontend',
    description:
      'This public site only hosts the interface. Your tasks, sessions, and Codex harness should run on your own machine through a local backend or bridge.',
    localAuthNote:
      'Use your own local Codex setup. Configure your API key or local Codex login on your machine first, then connect the bridge here.',
    endpointLabel: 'Local Bridge URL',
    endpointExample: 'Example:',
    primaryAction: 'Test Connection',
    saveAction: 'Save Endpoint',
    resetAction: 'Reset',
    redirecting: 'Connection verified. Opening workspace...',
    idle: 'No health check run yet.',
    checking: 'Checking local bridge status...',
    publicSiteWarning:
      'If you open this page from the public Vercel domain, browsers may block insecure local http/ws connections. Local development is the reliable path for now.',
    quickStart: 'Quick Start',
    workspaceAction: 'Open Workspace',
    homeAction: 'Back Home',
    savedEndpointPrefix: 'Saved endpoint:',
    emptySavedEndpoint: 'No browser endpoint override saved yet.',
  }
}

module.exports = {
  getConnectCopy,
}
