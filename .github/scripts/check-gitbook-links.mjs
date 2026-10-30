// Link check for the GitBook content under ubiid-openapi-spec/gitbook.
//
// GitBook commits straight to the synced branch and rewrites page-to-page links when a page is
// renamed or moved, but it does not follow a renamed heading: a `page.md#old-heading` link keeps
// opening the page at the top, without any error.
//
// Checked: relative links and images, with and without an #anchor, in Markdown and in HTML
// href/src attributes. Also reported: absolute app.gitbook.com/o/... editor links, which go stale
// when the space is restructured, and {% openapi %} blocks whose path + method is missing from the
// referenced spec, or that use a hosted spec instead of a file. Other external URLs and
// root-relative paths are out of scope.
//
// Usage:
//   node check-gitbook-links.mjs [DIR...]     # default: ../gitbook
//
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXTERNAL = /^([a-z][a-z0-9+.-]*:|\/\/|\/)/i;
const GITBOOK_EDITOR_URL = /^https?:\/\/app\.gitbook\.com\/o\//i;

// Calibrated against the anchors GitBook generated for this repo's headings and against the ids on
// the published sites: accents are stripped, dots survive, "&" becomes "and", "/" and repeated
// hyphens collapse, and a heading that starts with a digit gets an `id-` prefix.
export function slugify(heading) {
  const slug = heading
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\//g, ' ')
    .replace(/[^\w\s.-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-');
  return /^\d/.test(slug) ? `id-${slug}` : slug;
}

function plainText(heading) {
  return heading
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/[*`~]/g, '')
    .replace(/(^|\s)_+|_+(\s|$)/g, '$1$2');
}

function stripFencedCode(text) {
  const lines = text.split('\n');
  let fence = null;
  return lines.map((line) => {
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
      return '';
    }
    if (marker) {
      fence = marker[1];
      return '';
    }
    return line;
  });
}

export function headingAnchors(text) {
  const anchors = new Set();
  const seen = new Map();
  for (const line of stripFencedCode(text)) {
    const heading = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (heading && !/<a\b[^>]*\bid="/.test(heading[1])) {
      const base = slugify(plainText(heading[1]));
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      anchors.add(count === 0 ? base : `${base}-${count}`);
    }
    for (const id of line.matchAll(/\b(?:id|name)="([^"]+)"/g)) anchors.add(id[1]);
  }
  return anchors;
}

export function extractLinks(text) {
  const links = [];
  stripFencedCode(text).forEach((rawLine, index) => {
    const line = rawLine.replace(/`[^`]*`/g, '');
    for (const m of line.matchAll(/!?\[[^\]]*\]\(\s*(<[^>]*>|[^)\s]*)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g)) {
      links.push({ line: index + 1, target: m[1].replace(/^<|>$/g, '') });
    }
    for (const m of line.matchAll(/\b(?:href|src)="([^"]*)"/g)) {
      links.push({ line: index + 1, target: m[1] });
    }
  });
  return links;
}

export function extractOpenApiBlocks(text) {
  const blocks = [];
  stripFencedCode(text).forEach((line, index) => {
    const m = line.match(/\{%\s*(openapi(?:-operation)?)\b([^%]*)%\}/);
    if (!m) return;
    const attrs = Object.fromEntries([...m[2].matchAll(/(\w+)="([^"]*)"/g)].map((a) => [a[1], a[2]]));
    blocks.push({ line: index + 1, hosted: m[1] === 'openapi-operation', ...attrs });
  });
  return blocks;
}

export function specOperations(yaml) {
  const operations = new Set();
  let inPaths = false;
  let path = null;
  for (const line of yaml.split('\n')) {
    if (/^\S/.test(line)) {
      inPaths = /^paths:\s*(#.*)?$/.test(line);
      path = null;
      continue;
    }
    if (!inPaths) continue;
    const pathKey = line.match(/^ {2}(['"]?)(\/.*?)\1:\s*(?:#.*)?$/);
    if (pathKey) {
      path = pathKey[2];
      continue;
    }
    const method = line.match(/^ {4}(get|put|post|delete|patch|options|head|trace):/);
    if (method && path !== null) operations.add(`${method[1]} ${path}`);
  }
  return operations;
}

function markdownFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') files.push(...markdownFiles(path));
    } else if (entry.name.endsWith('.md')) {
      files.push(path);
    }
  }
  return files;
}

function decode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// Pages exported when the spaces shared one folder still point at another space's assets.
function assetHint(from, missing) {
  if (!missing.includes(`${sep}.gitbook${sep}assets${sep}`)) return '';
  for (let dir = dirname(from); dir !== dirname(dir); dir = dirname(dir)) {
    if (!existsSync(join(dir, '.gitbook'))) continue;
    const own = join(dir, '.gitbook', 'assets', basename(missing));
    return existsSync(own) ? ` (same file exists at ${relative(dirname(from), own)})` : '';
  }
  return '';
}

export function checkFiles(files) {
  const known = new Set(files.map((f) => resolve(f)));
  const anchorCache = new Map();
  const anchorsOf = (file) => {
    if (!anchorCache.has(file)) anchorCache.set(file, headingAnchors(readFileSync(file, 'utf8')));
    return anchorCache.get(file);
  };

  const operationCache = new Map();
  const operationsOf = (spec) => {
    if (!operationCache.has(spec)) operationCache.set(spec, specOperations(readFileSync(spec, 'utf8')));
    return operationCache.get(spec);
  };

  const problems = [];
  for (const file of files) {
    const from = resolve(file);
    const text = readFileSync(file, 'utf8');
    for (const block of extractOpenApiBlocks(text)) {
      if (block.hosted) {
        problems.push({
          file,
          line: block.line,
          target: block.spec ?? 'openapi-operation',
          reason: 'block uses a spec hosted in the GitBook organisation, which Git Sync never updates; use src with a file in .gitbook/assets',
        });
        continue;
      }
      if (!block.src || EXTERNAL.test(block.src) || !/\.ya?ml$/i.test(block.src)) continue;
      const spec = resolve(dirname(from), decode(block.src));
      if (!existsSync(spec) || !block.path || !block.method) continue;
      if (!operationsOf(spec).has(`${block.method.toLowerCase()} ${block.path}`)) {
        problems.push({
          file,
          line: block.line,
          target: `${block.method.toUpperCase()} ${block.path}`,
          reason: `operation not found in ${relative(dirname(from), spec)}`,
        });
      }
    }
    for (const { line, target } of extractLinks(text)) {
      if (GITBOOK_EDITOR_URL.test(target)) {
        problems.push({ file, line, target, reason: 'absolute GitBook editor link, use a relative link' });
        continue;
      }
      if (EXTERNAL.test(target)) continue;
      const hashAt = target.indexOf('#');
      const rawPath = hashAt === -1 ? target : target.slice(0, hashAt);
      const anchor = hashAt === -1 ? '' : decode(target.slice(hashAt + 1));
      if (rawPath === '' && anchor === '') continue;

      let resolved = rawPath === '' ? from : resolve(dirname(from), decode(rawPath.split('?')[0]));
      if (existsSync(resolved) && statSync(resolved).isDirectory()) resolved = join(resolved, 'README.md');
      if (!existsSync(resolved)) {
        problems.push({ file, line, target, reason: `target does not exist${assetHint(from, resolved)}` });
        continue;
      }
      if (anchor !== '' && resolved.endsWith('.md') && !anchorsOf(resolved).has(anchor)) {
        const where = known.has(resolved) ? relative(dirname(from), resolved) || '.' : resolved;
        problems.push({ file, line, target, reason: `no heading with anchor #${anchor} in ${where}` });
      }
    }
  }
  return problems;
}

function main(args) {
  const here = dirname(fileURLToPath(import.meta.url));
  const roots = args.length > 0 ? args : [resolve(here, '..', 'gitbook')];
  const files = roots.flatMap((root) => {
    if (!existsSync(root)) {
      console.error(`ERROR: ${root} does not exist`);
      process.exit(2);
    }
    return markdownFiles(root);
  });

  const problems = checkFiles(files);
  for (const p of problems) console.error(`${relative(process.cwd(), p.file)}:${p.line}: ${p.target} - ${p.reason}`);
  console.error(`\n${files.length} files checked, ${problems.length} broken link(s)`);
  process.exit(problems.length === 0 ? 0 : 1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
