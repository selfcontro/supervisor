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
    prerequisitesTitle: 'Prerequisites',
    prerequisites: [
      'Codex CLI is installed on this machine.',
      'Your local API key or Codex login is already configured.',
      'The local bridge is running before you test the endpoint.',
      'Use your own machine when connecting to your own local Codex runtime.',
    ],
    authSetupTitle: 'Local Auth Setup',
    authSetup: [
      'Preferred: configure OPENAI_API_KEY locally before starting the bridge.',
      'Alternative: sign in to Codex locally first, then let the bridge reuse that local auth.',
      'Do not paste your API key into this public site.',
    ],
    diagnosisTitle: 'Failure Diagnosis',
    diagnosis: [
      'HTTP health fails: the bridge is not running, the endpoint is wrong, or the port is blocked.',
      'WebSocket fails: the bridge is up, but realtime transport is unavailable from this page or browser.',
      'Authentication fails: configure your local API key or local Codex login on this machine first.',
      'Codex app-server fails: install Codex locally or restart the local runtime before retrying.',
    ],
    workspaceAction: 'Open Workspace',
    homeAction: 'Back Home',
    savedEndpointPrefix: 'Saved endpoint:',
    emptySavedEndpoint: 'No browser endpoint override saved yet.',
  }
}

module.exports = {
  getConnectCopy,
}
