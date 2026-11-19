#!/usr/bin/env node
/*
 * Re-vendors guacamole-common-js from apache/guacamole-client and regenerates the
 * ES module bundle at src/vendor/guacamole-common-js/index.js.
 *
 * Usage (from /app):
 *   node scripts/update-guac.mjs [tag]       fetch <tag> (default 1.6.0) and regenerate
 *   node scripts/update-guac.mjs --generate  regenerate index.js from the files on disk
 *
 * Set GITHUB_TOKEN to raise the GitHub API rate limit (optional). Uses only Node built-ins.
 *
 * Bundle order: upstream builds all.js with minify-maven-plugin 2.0.1 (configured in
 * guacamole-common-js/pom.xml, version pinned in the root pom.xml). It emits
 * common/license.js first, then every file matched by modules/**\/*.js sorted with
 * File.getName().compareToIgnoreCase() (ProcessFilesTask.getFilesToInclude). This script
 * reproduces that order. The modules only attach constructors to the shared `Guacamole`
 * namespace at load time; their only load-time cross-references
 * (`X.prototype = new Guacamole.Y()`) are within a single file.
 */

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'apache/guacamole-client';
const UPSTREAM_DIR = 'guacamole-common-js/src/main/webapp';
const DEFAULT_TAG = '1.6.0';

const here = path.dirname(fileURLToPath(import.meta.url));
const vendorDir = path.resolve(here, '../src/vendor/guacamole-common-js');
const modulesDir = path.join(vendorDir, 'modules');
const commonDir = path.join(vendorDir, 'common');

function apiHeaders() {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'update-guac-script' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return headers;
}

async function getJson(url) {
  const res = await fetch(url, { headers: apiHeaders() });
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
  return res.json();
}

async function getText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'update-guac-script' } });
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
  // Keep bytes exactly as upstream has them.
  return Buffer.from(await res.arrayBuffer());
}

/** Resolves a tag name to the commit SHA it points at (dereferencing annotated tags). */
async function resolveTag(tag) {
  const ref = await getJson(
    `https://api.github.com/repos/${REPO}/git/ref/tags/${encodeURIComponent(tag)}`,
  );
  let obj = ref.object;
  while (obj.type === 'tag') {
    obj = (await getJson(obj.url)).object;
  }
  if (obj.type !== 'commit') throw new Error(`Tag ${tag} points at a ${obj.type}, not a commit`);
  return obj.sha;
}

function rawUrl(sha, file) {
  return `https://raw.githubusercontent.com/${REPO}/${sha}/${file}`;
}

/** Java's String.compareToIgnoreCase, char by char. */
function compareToIgnoreCase(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    let x = a[i];
    let y = b[i];
    if (x === y) continue;
    x = x.toUpperCase();
    y = y.toUpperCase();
    if (x === y) continue;
    x = x.toLowerCase();
    y = y.toLowerCase();
    if (x !== y) return x.charCodeAt(0) - y.charCodeAt(0);
  }
  return a.length - b.length;
}

/** Same ordering as minify-maven-plugin 2.0.1 (ProcessFilesTask.getFilesToInclude). */
function upstreamOrder(names) {
  return [...names].sort(compareToIgnoreCase);
}

async function fetchTag(tag) {
  const sha = await resolveTag(tag);
  console.log(`Tag ${tag} -> commit ${sha}`);

  const listing = await getJson(
    `https://api.github.com/repos/${REPO}/contents/${UPSTREAM_DIR}/modules?ref=${sha}`,
  );
  const dirs = listing.filter((e) => e.type !== 'file');
  if (dirs.length > 0) {
    throw new Error(
      `Upstream modules/ now has subdirectories (${dirs.map((d) => d.name).join(', ')}); ` +
        'update this script to handle them.',
    );
  }
  const files = listing.filter((e) => e.type === 'file' && e.name.endsWith('.js'));

  await rm(modulesDir, { recursive: true, force: true });
  await rm(commonDir, { recursive: true, force: true });
  await mkdir(modulesDir, { recursive: true });
  await mkdir(commonDir, { recursive: true });

  for (const f of files) {
    await writeFile(path.join(modulesDir, f.name), await getText(rawUrl(sha, f.path)));
  }
  console.log(`Fetched ${files.length} modules`);

  await writeFile(
    path.join(commonDir, 'license.js'),
    await getText(rawUrl(sha, `${UPSTREAM_DIR}/common/license.js`)),
  );
  await writeFile(path.join(vendorDir, 'LICENSE'), await getText(rawUrl(sha, 'LICENSE')));
  await writeFile(path.join(vendorDir, 'NOTICE'), await getText(rawUrl(sha, 'NOTICE')));

  await writeFile(path.join(vendorDir, 'README.md'), readme(tag, sha));
  return { tag, sha };
}

function readme(tag, sha) {
  return `# guacamole-common-js (vendored)

The official Apache Guacamole JavaScript client library, copied unmodified from
[\`${REPO}\`](https://github.com/${REPO}).

| | |
|---|---|
| Tag | \`${tag}\` |
| Commit | \`${sha}\` |
| Upstream path | \`${UPSTREAM_DIR}/\` |

Contents:

- \`modules/*.js\`: upstream \`${UPSTREAM_DIR}/modules/*.js\`, byte-for-byte.
- \`common/license.js\`: upstream \`${UPSTREAM_DIR}/common/license.js\` (the header upstream
  puts at the top of its concatenated \`all.js\`).
- \`LICENSE\`, \`NOTICE\`: the upstream repository's root licence and notice files.
- \`index.js\`: **generated**. The modules concatenated in upstream's build order and wrapped
  as an ES module whose default export is the \`Guacamole\` namespace. Do not edit by hand.
- \`index.d.ts\`: hand-written TypeScript declarations for the parts this app uses, derived
  from the module sources above. Review them when updating to a new tag.
- \`vendor.test.ts\`: a smoke test for the bundle.

To update, from \`/app\`:

\`\`\`sh
node scripts/update-guac.mjs <tag>      # fetch a tag and regenerate index.js and this README
node scripts/update-guac.mjs --generate # regenerate index.js from the files on disk
\`\`\`

This directory is excluded from ESLint and Prettier. Usage: \`import Guacamole from
'../vendor/guacamole-common-js'\` (adjust the relative path).
`;
}

async function readVersionInfo() {
  // Recover tag/commit from the README so --generate keeps the header accurate.
  try {
    const text = await readFile(path.join(vendorDir, 'README.md'), 'utf8');
    const tag = /\| Tag \| `([^`]+)` \|/.exec(text)?.[1];
    const sha = /\| Commit \| `([0-9a-f]{40})` \|/.exec(text)?.[1];
    if (tag && sha) return { tag, sha };
  } catch {
    // fall through
  }
  throw new Error('Cannot read tag/commit from README.md; run with a tag first.');
}

/**
 * Small, documented fixes applied to the generated bundle only. The files in
 * ./modules stay byte-for-byte upstream; generation fails if a patch stops applying.
 */
const BUNDLE_PATCHES = [
  {
    file: 'Display.js',
    why: 'close the decoded VideoFrame after drawing (upstream leaks it until GC)',
    find: 'layer.drawImage(x, y, decodedFrame);',
    replace:
      'layer.drawImage(x, y, decodedFrame);\n' +
      '                /* OpenMobileGuac patch: release the frame instead of waiting for GC. */\n' +
      '                if (decodedFrame && decodedFrame.close) decodedFrame.close();',
  },
];

async function generate({ tag, sha }) {
  const names = upstreamOrder((await readdir(modulesDir)).filter((n) => n.endsWith('.js')));
  if (names.length === 0) throw new Error(`No modules found in ${modulesDir}`);

  const license = (await readFile(path.join(commonDir, 'license.js'), 'utf8')).trimEnd();
  const parts = [];
  parts.push(
    `/*
 * GENERATED FILE - DO NOT EDIT.
 *
 * Generated by app/scripts/update-guac.mjs from the unmodified files in ./modules, plus the
 * documented patches in BUNDLE_PATCHES (app/scripts/update-guac.mjs)
 * (apache/guacamole-client tag ${tag}, commit ${sha}).
 * Regenerate with: node scripts/update-guac.mjs --generate
 *
 * The upstream modules are classic scripts that attach to a shared \`Guacamole\`
 * namespace. They are concatenated here in upstream's all.js order and wrapped in a
 * function so that the namespace can be exported as an ES module.
 */
/* eslint-disable */
// @ts-nocheck
`,
  );
  parts.push(license, '');
  parts.push('const Guacamole = (function () {', '');
  for (const name of names) {
    let src = (await readFile(path.join(modulesDir, name), 'utf8')).trimEnd();
    for (const patch of BUNDLE_PATCHES.filter((p) => p.file === name)) {
      if (!src.includes(patch.find)) {
        throw new Error(`Bundle patch no longer applies to ${name}: ${patch.why}`);
      }
      src = src.replace(patch.find, patch.replace);
    }
    parts.push(`// ---- modules/${name} ----`, src, '');
  }
  parts.push('return Guacamole;', '})();', '', 'export default Guacamole;', '');

  await writeFile(path.join(vendorDir, 'index.js'), parts.join('\n'));
  console.log(`Wrote index.js (${names.length} modules): ${names.join(', ')}`);
}

async function main() {
  const arg = process.argv[2];
  if (arg === '--help' || arg === '-h') {
    console.log('Usage: node scripts/update-guac.mjs [tag | --generate]');
    return;
  }
  const info = arg === '--generate' ? await readVersionInfo() : await fetchTag(arg ?? DEFAULT_TAG);
  await generate(info);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
