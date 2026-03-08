/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    '^@goldenflop/shared$': '<rootDir>/../../packages/shared/dist/index.js',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        paths: {
          '@goldenflop/shared': ['../../packages/shared/dist/index.js'],
        },
      },
    }],
  },
  testTimeout: 15000,
  verbose: true,
  forceExit: true,
  detectOpenHandles: true,
};
