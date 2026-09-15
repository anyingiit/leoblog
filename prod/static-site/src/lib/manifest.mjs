import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
export function writeManifest(outputDir, routes) {
  const files = [];
  const root = fs.realpathSync(outputDir);
  const allowed = (relative) => {
    if (relative === "/manifest.json" || relative === "/raw-public.json" || relative.endsWith(".map")) return false;
    if (relative.startsWith("/private/") || relative.startsWith("/._private/")) return false;
    return /\.html$|\.(?:js|css)$/i.test(relative) || ["/robots.txt", "/sitemap.xml"].includes(relative);
  };
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(full);
      else {
        const relative = "/" + path.relative(outputDir, full).split(path.sep).join("/");
        const resolved = fs.realpathSync(full);
        if (!resolved.startsWith(`${root}${path.sep}`) || !allowed(relative)) continue;
        const bytes = fs.readFileSync(full);
        files.push({ path: relative, sha256: crypto.createHash("sha256").update(bytes).digest("hex"), size: bytes.length });
      }
    }
  }
  walk(outputDir);
  const assetRoutes = files.filter((file) => /\.(?:js|css)$/i.test(file.path)).map((file) => file.path);
  const manifest = { version: 1, routes: [...new Set([...routes, ...assetRoutes])].sort(), files: files.sort((a, b) => a.path.localeCompare(b.path)) };
  fs.writeFileSync(path.join(outputDir, "manifest.json"), JSON.stringify(manifest));
  return manifest;
}

export function contentTypeForAsset(assetPath) {
  if (/\.html$/i.test(assetPath)) return "text/html; charset=utf-8";
  if (/\.js$/i.test(assetPath)) return "text/javascript; charset=utf-8";
  if (/\.css$/i.test(assetPath)) return "text/css; charset=utf-8";
  if (assetPath === "/sitemap.xml") return "application/xml; charset=utf-8";
  if (assetPath === "/robots.txt") return "text/plain; charset=utf-8";
  return null;
}
