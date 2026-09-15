export const ORIGIN = 'https://douseful.eu.org';
export const INDEXED_PATHS = ['/', '/posts/hello-world'];

export function canonicalUrl(path) {
  if (!INDEXED_PATHS.includes(path)) throw new Error('Invalid canonical path');
  return `${ORIGIN}${path}`;
}

export const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${INDEXED_PATHS.map(path => `<url><loc>${canonicalUrl(path)}</loc></url>`).join('')}</urlset>\n`;
export const ROBOTS = `User-agent: *\nAllow: /\nSitemap: ${ORIGIN}/sitemap.xml\n`;
