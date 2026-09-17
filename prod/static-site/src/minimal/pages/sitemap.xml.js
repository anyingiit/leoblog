import {indexedPaths,sitemapXml} from '../discovery.mjs';
import {getSnapshot} from '../../lib/content.mjs';
export function GET() {
  return new Response(sitemapXml(indexedPaths(getSnapshot())), {headers: {'Content-Type': 'application/xml; charset=utf-8'}});
}
