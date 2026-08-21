import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertStrictSemver, packages } from './release-packages.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let expected;
for (const entry of packages) {
  const manifest = JSON.parse(await readFile(resolve(root, entry.directory, 'package.json'), 'utf8'));
  if (manifest.name !== entry.name || typeof manifest.version !== 'string') throw new Error(`Malformed manifest: ${entry.directory}/package.json`);
  const version = assertStrictSemver(manifest.version);
  if (expected === undefined) expected = version;
  if (version !== expected) throw new Error(`${entry.name} is ${version}; expected ${expected}`);
}
process.stdout.write(`${expected}\n`);
