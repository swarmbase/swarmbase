import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertStrictSemver, packages } from './release-packages.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.length !== 1) {
  throw new Error('Usage: yarn version:set <version>');
}
const version = assertStrictSemver(args[0]);

const manifests = await Promise.all(packages.map(async (entry) => {
  const path = resolve(root, entry.directory, 'package.json');
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  if (manifest.name !== entry.name || typeof manifest.version !== 'string') {
    throw new Error(`Malformed manifest: ${entry.directory}/package.json`);
  }
  assertStrictSemver(manifest.version);
  return { path, manifest };
}));

for (const { path, manifest } of manifests) {
  manifest.version = version;
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

const result = spawnSync('yarn', ['install', '--mode=update-lockfile'], {
  cwd: root,
  encoding: 'utf8',
  stdio: 'inherit',
});
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`Lockfile update failed with status ${result.status}`);
