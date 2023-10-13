const { join } = require('node:path');

/*
 * For a detailed explanation regarding each configuration property and type check, visit:
 * https://jestjs.io/docs/configuration
 */
module.exports = {
  projects: ['<rootDir>/jest-e2e.config.js', '<rootDir>/jest-unit.config.js'],
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageProvider: 'v8',
  modulePathIgnorePatterns: ['<rootDir>/.build', '<rootDir>/dist/', '<rootDir>/build/'],
  preset: 'ts-jest',
  restoreMocks: true,
  setupFiles: [join(__dirname, './jest.setup.js')],
  testEnvironment: 'jest-environment-node',
};
