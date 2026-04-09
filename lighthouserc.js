export default {
  ci: {
    collect: {
      startServerCommand: 'npm run preview',
      url: ['http://localhost:4173'],
      numberOfRuns: 3,
    },
    assert: {
      assertions: {
        'categories:performance': ['error', { minScore: 0.95 }],
        'categories:accessibility': ['error', { minScore: 0.90 }],
        'categories:best-practices': ['error', { minScore: 0.90 }],
        'resource-summary:script:size': ['error', { maxNumericValue: 81920 }], // 80KB
        'first-contentful-paint': ['error', { maxNumericValue: 1000 }],
      },
    },
  },
};
