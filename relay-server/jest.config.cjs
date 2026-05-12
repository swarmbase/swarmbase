/** @type {import('jest').Config} */
module.exports = {
  // Match the collabswarm pattern: although package.json declares
  // "type": "module", we compile TS down to CommonJS for tests via
  // ts-jest. Real production builds still emit ESM (see tsconfig.json).
  rootDir: __dirname,
  roots: ['<rootDir>/src'],
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.test.json',
        // ts-jest does not need ESM here because we override the test
        // tsconfig to emit CommonJS.
        useESM: false,
      },
    ],
  },
  // The runtime sources use ESM-style relative imports ending in `.js`
  // (e.g. `./config.js`). Under jest+ts-jest+CommonJS we rewrite those
  // back to extensionless paths so the resolver finds the .ts source.
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
}
