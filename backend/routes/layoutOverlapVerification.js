const express = require('express')

const router = express.Router()

function buildMockVerificationResponse() {
  const generatedAt = new Date().toISOString()

  return {
    stub: true,
    dataSource: 'static-mock',
    endpoint: '/api/layout-overlap-verification/mock',
    status: 'not-run',
    generatedAt,
    verification: {
      scope: 'layout-overlap',
      version: 'mock-v1',
      summary: {
        checkedLayoutCount: 3,
        overlapCount: 2,
        unresolvedCount: 1
      },
      records: [
        {
          id: 'overlap-001',
          layoutId: 'home-page',
          severity: 'medium',
          status: 'needs-review',
          elements: ['hero-card', 'cta-panel'],
          overlapAreaPx: 128,
          bounds: {
            left: 240,
            top: 88,
            width: 320,
            height: 96
          },
          note: 'Static placeholder record for future UI integration.'
        },
        {
          id: 'overlap-002',
          layoutId: 'pricing-page',
          severity: 'low',
          status: 'resolved-in-mock',
          elements: ['plan-column', 'sticky-banner'],
          overlapAreaPx: 42,
          bounds: {
            left: 64,
            top: 512,
            width: 180,
            height: 40
          },
          note: 'Mock data only; not a real verification result.'
        }
      ]
    }
  }
}

router.get('/mock', (req, res) => {
  res.json(buildMockVerificationResponse())
})

module.exports = router
