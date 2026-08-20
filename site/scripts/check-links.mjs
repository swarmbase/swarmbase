#!/usr/bin/env node

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultDistDirectory = fileURLToPath(
  new URL('../dist', import.meta.url),
);
const distDirectory = resolve(process.argv[2] ?? defaultDistDirectory);
const maxDiagnostics = 100;

function decodeHtmlEntities(value) {
  const namedEntities = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: '\u00a0',
    quot: '"',
  };

  return value.replace(
    /&(#\d+|#x[\da-f]+|amp|apos|gt|lt|nbsp|quot);/gi,
    (entity, body) => {
      if (body.startsWith('#x') || body.startsWith('#X')) {
        return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
      }
      if (body.startsWith('#')) {
        return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
      }
      return namedEntities[body.toLowerCase()] ?? entity;
    },
  );
}

function attributesFor(tag) {
  const attributes = new Map();
  const attributePattern = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

  for (const match of tag.matchAll(attributePattern)) {
    attributes.set(
      match[1].toLowerCase(),
      decodeHtmlEntities(match[2] ?? match[3]),
    );
  }

  return attributes;
}

function collectFiles(directory, relativeDirectory = '', files = new Set()) {
  const entries = readdirSync(resolve(directory, relativeDirectory), {
    withFileTypes: true,
  }).sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const relativePath = relativeDirectory
      ? `${relativeDirectory}/${entry.name}`
      : entry.name;
    if (entry.isDirectory()) {
      collectFiles(directory, relativePath, files);
    } else if (entry.isFile()) {
      files.add(relativePath);
    }
  }

  return files;
}

function findSiteRoot(indexHtml) {
  const htmlWithoutComments = indexHtml.replace(/<!--[\s\S]*?-->/g, '');

  for (const match of htmlWithoutComments.matchAll(/<link\b[^>]*>/gi)) {
    const attributes = attributesFor(match[0]);
    const rel = attributes.get('rel')?.toLowerCase().split(/\s+/) ?? [];
    if (!rel.includes('canonical')) continue;

    const href = attributes.get('href');
    if (!href) break;

    const siteRoot = new URL(href);
    if (!['http:', 'https:'].includes(siteRoot.protocol)) break;
    siteRoot.hash = '';
    siteRoot.search = '';
    if (!siteRoot.pathname.endsWith('/')) siteRoot.pathname += '/';
    return siteRoot;
  }

  throw new Error('index.html has no HTTP canonical URL');
}

function pageUrl(relativePath, siteRoot) {
  if (relativePath === 'index.html') return new URL(siteRoot);
  if (relativePath.endsWith('/index.html')) {
    return new URL(relativePath.slice(0, -'index.html'.length), siteRoot);
  }
  return new URL(relativePath, siteRoot);
}

function anchorsFor(html, relativePath, diagnostics) {
  const htmlWithoutComments = html.replace(/<!--[\s\S]*?-->/g, '');
  const anchors = new Set();
  const ids = new Set();

  for (const match of htmlWithoutComments.matchAll(/<[a-z][^>]*>/gi)) {
    const attributes = attributesFor(match[0]);
    const id = attributes.get('id');
    if (id !== undefined) {
      if (ids.has(id)) {
        diagnostics.push(`${relativePath}: duplicate id "${id}"`);
      }
      ids.add(id);
      anchors.add(id);
    }

    if (/^<a\b/i.test(match[0])) {
      const name = attributes.get('name');
      if (name !== undefined) anchors.add(name);
    }
  }

  return anchors;
}

function decodedPath(pathname) {
  return pathname
    .split('/')
    .map((segment) => decodeURIComponent(segment))
    .join('/');
}

function artifactFor(url, files, basePath) {
  if (
    basePath &&
    url.pathname !== basePath &&
    !url.pathname.startsWith(`${basePath}/`)
  ) {
    return { error: `escapes base path "${basePath}/"` };
  }

  const pathname = decodedPath(url.pathname.slice(basePath.length));
  const segments = pathname.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    return { error: 'escapes the site output directory' };
  }

  const relativePath = segments.join('/');
  if (!relativePath) return { artifact: 'index.html' };

  const candidates = url.pathname.endsWith('/')
    ? [`${relativePath}/index.html`]
    : [relativePath, `${relativePath}/index.html`];
  const artifact = candidates.find((candidate) => files.has(candidate));

  return artifact
    ? { artifact }
    : {
        error: `missing target ${candidates
          .map((candidate) => `"${candidate}"`)
          .join(' or ')}`,
      };
}

function anchorFrom(hash) {
  if (!hash || hash === '#') return '';
  const fragment = hash.slice(1).split(':~:text=', 1)[0];
  return decodeURIComponent(fragment);
}

function run() {
  let files;
  try {
    files = collectFiles(distDirectory);
  } catch (error) {
    throw new Error(
      `${distDirectory} does not exist; build the site first`,
      { cause: error },
    );
  }

  const htmlFiles = [...files]
    .filter((relativePath) => relativePath.endsWith('.html'))
    .sort();
  if (htmlFiles.length === 0) {
    throw new Error(`${distDirectory} contains no HTML files`);
  }

  const htmlByFile = new Map(
    htmlFiles.map((relativePath) => [
      relativePath,
      readFileSync(resolve(distDirectory, relativePath), 'utf8'),
    ]),
  );
  const siteRoot = findSiteRoot(htmlByFile.get('index.html') ?? '');
  const basePath =
    siteRoot.pathname === '/' ? '' : siteRoot.pathname.slice(0, -1);
  const diagnostics = [];
  const anchorsByFile = new Map(
    htmlFiles.map((relativePath) => [
      relativePath,
      anchorsFor(htmlByFile.get(relativePath), relativePath, diagnostics),
    ]),
  );
  let internalLinkCount = 0;

  for (const relativePath of htmlFiles) {
    const html = (htmlByFile.get(relativePath) ?? '').replace(
      /<!--[\s\S]*?-->/g,
      '',
    );
    const sourceUrl = pageUrl(relativePath, siteRoot);

    for (const match of html.matchAll(/<a\b[^>]*>/gi)) {
      const href = attributesFor(match[0]).get('href');
      if (href === undefined) continue;

      let url;
      try {
        url = new URL(href, sourceUrl);
      } catch {
        diagnostics.push(`${relativePath}: invalid href="${href}"`);
        continue;
      }

      if (!['http:', 'https:'].includes(url.protocol)) continue;
      if (url.origin !== siteRoot.origin) continue;
      internalLinkCount += 1;

      let result;
      try {
        result = artifactFor(url, files, basePath);
      } catch {
        diagnostics.push(
          `${relativePath}: href="${href}" has invalid percent encoding`,
        );
        continue;
      }

      if (result.error) {
        diagnostics.push(`${relativePath}: href="${href}" -> ${result.error}`);
        continue;
      }

      if (!result.artifact.endsWith('.html')) continue;

      let anchor;
      try {
        anchor = anchorFrom(url.hash);
      } catch {
        diagnostics.push(
          `${relativePath}: href="${href}" has invalid fragment encoding`,
        );
        continue;
      }

      if (anchor && !anchorsByFile.get(result.artifact)?.has(anchor)) {
        diagnostics.push(
          `${relativePath}: href="${href}" -> missing anchor "${anchor}"`,
        );
      }
    }
  }

  diagnostics.sort();
  if (diagnostics.length > 0) {
    console.error(`Site link check found ${diagnostics.length} issue(s):`);
    for (const diagnostic of diagnostics.slice(0, maxDiagnostics)) {
      console.error(`- ${diagnostic}`);
    }
    if (diagnostics.length > maxDiagnostics) {
      console.error(
        `- ... ${diagnostics.length - maxDiagnostics} more issue(s) omitted`,
      );
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `Checked ${internalLinkCount} internal links in ${htmlFiles.length} HTML files; 0 issues.`,
  );
}

try {
  run();
} catch (error) {
  console.error(`Site link check failed: ${error.message}`);
  process.exitCode = 1;
}
