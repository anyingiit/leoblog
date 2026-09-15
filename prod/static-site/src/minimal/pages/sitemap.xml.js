import {SITEMAP} from '../discovery.mjs';
export function GET() {
  return new Response(SITEMAP, {headers: {'Content-Type': 'application/xml; charset=utf-8'}});
}
