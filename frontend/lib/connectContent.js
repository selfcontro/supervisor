function getConnectCopy() {
  return {
    badge: 'Connect Local Codex',
    title: 'Use your own local Codex runtime from the Vercel frontend',
    description:
      'This public site only hosts the interface. Your tasks, sessions, and Codex harness should run on your own machine through a local backend or bridge.',
    endpointLabel: 'Local Bridge URL',
    endpointExample: 'Example:',
    primaryAction: 'Test Connection',
    saveAction: 'Save Endpoint',
    resetAction: 'Reset',
    redirecting: 'Connection verified. Opening workspace...',
    idle: 'No health check run yet.',
    checking: 'Checking local bridge status...',
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
