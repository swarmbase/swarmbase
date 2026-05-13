/** @type {import('jest').Config} */
module.exports = {
  // relay-server intentionally uses a different Jest/ts-jest mode than
  // the other workspaces in this repo. Most workspaces run ts-jest with
  // `useESM: true` so the test runtime is true ESM; here we keep
  // `useESM: false` so ts-jest transforms TS to CommonJS for the jest
  // runtime, while the `module: Node16` in tsconfig.test.json keeps the
  // ESM-style `./foo.js` specifiers typechecking. Real production builds
  // of relay-server still emit ESM (see tsconfig.json). If you migrate
  // this workspace to `useESM: true`, also flip the test tsconfig and
  // drop the moduleNameMapper hack below.
  rootDir: __dirname,
  roots: ['<rootDir>/src'],
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.test.json',
        // We transform sources to CommonJS at the jest layer
        // (useESM: false). The test tsconfig keeps
        // `module: Node16` / `moduleResolution: node16` so the
        // ESM-style `./foo.js` specifiers used across the codebase
        // typecheck correctly. ts-jest's "hybrid module kind"
        // warning (TS151002) is intentionally suppressed: enabling
        // `isolatedModules` would force ts-jest to emit real ESM
        // and break the CJS jest runtime.
        useESM: false,
        diagnostics: { ignoreCodes: [151002] },
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
