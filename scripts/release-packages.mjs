export const packages = [
  { name: '@swarmbase/collabswarm', directory: 'packages/collabswarm', entries: ['dist/esm/src/index.js', 'dist/esm/src/index.d.ts', 'dist/esm/src/collabswarm-node.js', 'dist/esm/src/collabswarm-node.d.ts', 'dist/esm/src/browser-primitives.js', 'dist/esm/src/browser-primitives.d.ts', 'dist/cjs/src/index.js', 'dist/cjs/src/collabswarm-node.js', 'dist/cjs/src/browser-primitives.js', 'dist/cjs/package.json'], bins: [] },
  { name: '@swarmbase/collabswarm-automerge', directory: 'packages/collabswarm-automerge', entries: ['dist/esm/src/index.js', 'dist/esm/src/index.d.ts', 'dist/cjs/src/index.js', 'dist/cjs/package.json'], bins: ['dist/esm/bin/collabswarm-automerge-d.js'] },
  { name: '@swarmbase/collabswarm-yjs', directory: 'packages/collabswarm-yjs', entries: ['dist/esm/src/index.js', 'dist/esm/src/index.d.ts', 'dist/cjs/src/index.js', 'dist/cjs/package.json'], bins: ['dist/esm/bin/collabswarm-yjs-d.js'] },
  { name: '@swarmbase/collabswarm-react', directory: 'packages/collabswarm-react', entries: ['dist/esm/src/index.js', 'dist/esm/src/index.d.ts', 'dist/cjs/src/index.js', 'dist/cjs/package.json'], bins: [] },
  { name: '@swarmbase/collabswarm-redux', directory: 'packages/collabswarm-redux', entries: ['dist/esm/src/index.js', 'dist/esm/src/index.d.ts', 'dist/cjs/src/index.js', 'dist/cjs/package.json'], bins: [] },
  { name: '@swarmbase/collabswarm-index', directory: 'packages/collabswarm-index', entries: ['dist/esm/src/index.js', 'dist/esm/src/index.d.ts', 'dist/esm/src/react.js', 'dist/esm/src/react.d.ts', 'dist/cjs/src/index.js', 'dist/cjs/src/react.js', 'dist/cjs/package.json'], bins: [] },
];

export const strictSemver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export const stagingPattern = /^[a-z][a-z0-9._-]*$/;
export const RESERVED_TAGS = ['latest', 'next'];

export function assertStrictSemver(version) {
  if (typeof version !== 'string' || !strictSemver.test(version)) {
    throw new Error(`Invalid strict SemVer: ${String(version)}`);
  }
  return version;
}
