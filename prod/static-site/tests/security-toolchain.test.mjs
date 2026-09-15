import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root = new URL('../', import.meta.url);
const pkg = JSON.parse(fs.readFileSync(new URL('package.json', root)));
const lock = JSON.parse(fs.readFileSync(new URL('package-lock.json', root)));
const atLeast = (value, minimum) => value.split('.').map(Number).reduce((r, n, i) => r || Math.sign(n - minimum[i]), 0) >= 0;
test('SEC001: locked Astro and every Sharp copy meet official fixed versions', () => {
  assert.ok(atLeast(lock.packages['node_modules/astro'].version, [7, 2, 8]), 'Astro must include GHSA-26w7-cxv4-gfx2 fix');
  assert.equal(pkg.dependencies.astro, lock.packages['node_modules/astro'].version, 'direct Astro version must be exact');
  const sharp = Object.entries(lock.packages).filter(([name]) => name.endsWith('/sharp'));
  assert.ok(sharp.length);
  for (const [name, entry] of sharp) assert.ok(atLeast(entry.version, [0, 35, 4]), `${name} must include libheif fix`);
});
