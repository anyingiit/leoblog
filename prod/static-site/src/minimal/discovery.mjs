export const ORIGIN = 'https://douseful.eu.org';

// Every indexed path for a snapshot: the homepage plus one entry per
// registered article, in registration order (docs/contracts/frozen-input-v2.md).
export function indexedPaths(snapshot) {
  return ['/', ...snapshot.posts.map(post => '/posts/' + post.slug)];
}

export function canonicalUrl(path, paths) {
  if (!paths.includes(path)) throw new Error('Invalid canonical path');
  return `${ORIGIN}${path}`;
}

// docs/contracts/frozen-input-v2.md section 2.4: paths are sorted (with '/'
// first, which already sorts first) before being emitted.
export function sitemapXml(paths) {
  const sorted = [...paths].sort();
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${sorted.map(path => `<url><loc>${ORIGIN}${path}</loc></url>`).join('')}</urlset>\n`;
}

export const ROBOTS = `User-agent: *\nAllow: /\nSitemap: ${ORIGIN}/sitemap.xml\n`;
