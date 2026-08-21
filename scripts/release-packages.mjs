export const packages = [
  { name: '@swarmbase/collabswarm', directory: 'packages/collabswarm', entries: ['dist/src/index.js', 'dist/src/index.d.ts', 'dist/src/collabswarm-node.js', 'dist/src/collabswarm-node.d.ts', 'dist/src/browser-primitives.js', 'dist/src/browser-primitives.d.ts'], bins: [] },
  { name: '@swarmbase/collabswarm-automerge', directory: 'packages/collabswarm-automerge', entries: ['dist/src/index.js', 'dist/src/index.d.ts'], bins: ['dist/bin/collabswarm-automerge-d.js'] },
  { name: '@swarmbase/collabswarm-yjs', directory: 'packages/collabswarm-yjs', entries: ['dist/src/index.js', 'dist/src/index.d.ts'], bins: ['dist/bin/collabswarm-yjs-d.js'] },
  { name: '@swarmbase/collabswarm-react', directory: 'packages/collabswarm-react', entries: ['dist/src/index.js', 'dist/src/index.d.ts'], bins: [] },
  { name: '@swarmbase/collabswarm-redux', directory: 'packages/collabswarm-redux', entries: ['dist/src/index.js', 'dist/src/index.d.ts'], bins: [] },
  { name: '@swarmbase/collabswarm-index', directory: 'packages/collabswarm-index', entries: ['dist/src/index.js', 'dist/src/index.d.ts', 'dist/src/react.js', 'dist/src/react.d.ts'], bins: [] },
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
