const test = require('node:test')
const assert = require('node:assert/strict')

const { githubRepoLink } = require('./landingLinks')

test('github repo link points to the public repository', () => {
  assert.deepEqual(githubRepoLink, {
    label: 'GitHub Repository',
    href: 'https://github.com/selfcontro/supervisor.git',
    external: true,
  })
})
