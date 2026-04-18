function shouldAutoEnterWorkspace(checks) {
  if (!checks || typeof checks !== 'object') {
    return false
  }

  const requiredKeys = ['http', 'websocket', 'codex', 'auth']

  return requiredKeys.every((key) => checks[key]?.status === 'ok')
}

module.exports = {
  shouldAutoEnterWorkspace,
}
