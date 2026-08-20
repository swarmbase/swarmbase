import assert from 'node:assert/strict';
import test from 'node:test';
import { assertStrictSemver, packages } from './release-packages.mjs';

test('staging dist-tag rejects latest and next', () => {
  const stagingPattern = /^[a-z][a-z0-9._-]*$/;
  for (const tag of ['latest', 'next', 'Latest']) {
    assert.ok(!stagingPattern.test(tag) || ['latest', 'next'].includes(tag) === true, `${tag} should not be a valid staging tag`);
  }
  for (const tag of ['release-1', 'tmp.abc', 'swarmbase-stage']) {
    assert.ok(stagingPattern.test(tag) && !['latest', 'next'].includes(tag), `${tag} should be an allowed staging tag`);
  }
});

test('release ordered packages list is exact', () => {
  assert.deepEqual(packages.map(({ name }) => name), [
    '@swarmbase/collabswarm',
    '@swarmbase/collabswarm-automerge',
    '@swarmbase/collabswarm-yjs',
    '@swarmbase/collabswarm-react',
    '@swarmbase/collabswarm-redux',
    '@swarmbase/collabswarm-index',
  ]);
});

test('strict SemVer rejects non-canonical versions', () => {
  assert.throws(() => assertStrictSemver(undefined));
  assert.throws(() => assertStrictSemver('v1.2.3'));
  assert.throws(() => assertStrictSemver('01.2.3'));
});