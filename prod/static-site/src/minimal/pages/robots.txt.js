import {ROBOTS} from '../discovery.mjs';
export function GET() {
  return new Response(ROBOTS, {headers: {'Content-Type': 'text/plain; charset=utf-8'}});
}
