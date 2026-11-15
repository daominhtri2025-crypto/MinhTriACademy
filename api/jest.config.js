const transform = { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] };
module.exports = {
  testTimeout: 30000,
  projects: [
    { displayName: 'unit', testEnvironment: 'node', transform, testMatch: ['<rootDir>/src/**/*.spec.ts'] },
    {
      displayName: 'integration', testEnvironment: 'node', transform,
      testMatch: ['<rootDir>/test/**/*.int-spec.ts'],
      globalSetup: '<rootDir>/test/global-setup.js',
    },
  ],
};
