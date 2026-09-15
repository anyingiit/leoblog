import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { contentTypeForAsset } from "../src/lib/manifest.mjs";
const root = path.resolve(process.argv[2] || "dist");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const members = new Map(manifest.files.map((file) => [file.path, file]));
const server = http.createServer((request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") { response.writeHead(405); response.end(); return; }
  const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  const route = pathname.endsWith("/") ? `${pathname}index.html` : (members.has(pathname) ? pathname : `${pathname}/index.html`);
  const entry = members.get(route);
  if (!entry) { response.writeHead(404); response.end("Not found"); return; }
  const file = path.join(root, route.replace(/^\/+/, ""));
  if (!file.startsWith(`${root}${path.sep}`) || !fs.existsSync(file)) { response.writeHead(404); response.end("Not found"); return; }
  response.writeHead(200, { "Content-Type": contentTypeForAsset(route) || "application/octet-stream", "ETag": `"${entry.sha256}"` });
  if (request.method !== "HEAD") fs.createReadStream(file).pipe(response); else response.end();
});
server.listen(Number(process.env.PORT || 4173), "127.0.0.1");
