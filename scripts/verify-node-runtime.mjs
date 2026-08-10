import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const packagePaths = ['package.json', 'apps/api/package.json', 'apps/web/package.json'];
const ranges = packagePaths.map((relativePath) => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
  const range = manifest.engines?.node;
  if (typeof range !== 'string' || !range.trim()) {
    throw new Error(`NODE_ENGINE_RANGE_MISSING:${relativePath}`);
  }
  return { relativePath, range: range.trim() };
});

const expectedRange = ranges[0].range;
if (ranges.some(({ range }) => range !== expectedRange)) {
  throw new Error(`NODE_ENGINE_RANGE_MISMATCH:${ranges.map(({ relativePath, range }) => `${relativePath}=${range}`).join(',')}`);
}

const supported = /^>=\s*(\d+)\s*<\s*(\d+)$/.exec(expectedRange);
if (!supported) {
  throw new Error(`NODE_ENGINE_RANGE_UNSUPPORTED:${expectedRange}`);
}

const major = Number(process.versions.node.split('.')[0]);
const minimum = Number(supported[1]);
const maximumExclusive = Number(supported[2]);
if (!Number.isInteger(major) || major < minimum || major >= maximumExclusive) {
  console.error(`UNSUPPORTED_NODE_RUNTIME:${process.versions.node}: expected ${expectedRange}`);
  process.exit(1);
}

console.log(`Node ${process.versions.node} satisfies ${expectedRange}.`);