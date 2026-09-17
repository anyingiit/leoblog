import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadSnapshot } from "../src/lib/content.mjs";
import { writeManifest } from "../src/lib/manifest.mjs";
import { loadPublicationIdentity } from "../src/lib/identity.mjs";
import { resolveProfile } from "../src/lib/profile.mjs";
const packageRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
export function resolveAstroExecutable(root = packageRoot) {
  const executable = path.join(root, "node_modules", "astro", "bin", "astro.mjs");
  if (!fs.existsSync(executable)) throw new Error(`local Astro dependency is missing: ${executable}`);
  return executable;
}
if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url))) {
 const profile = resolveProfile();
 const inputArg = process.argv[2] || process.env.SNAPSHOT_PATH;
 const outputArg = process.argv[3];
 if (process.env.OUTPUT_DIR) throw new Error("OUTPUT_DIR runner mode is not supported; an artifact output path is required");
 if (!inputArg || !outputArg) throw new Error("snapshot directory and output artifact are required");
 const input = inputArg && fs.existsSync(inputArg) && fs.statSync(inputArg).isDirectory() ? path.join(inputArg, "public.json") : inputArg;
 const artifactMode = Boolean(inputArg && fs.existsSync(inputArg) && fs.statSync(inputArg).isDirectory());
 const output = artifactMode ? fs.mkdtempSync(`${outputArg}.static-build-`) : outputArg;
 if (!input || !output) throw new Error("snapshot directory and output artifact are required");
 const identity = loadPublicationIdentity(path.dirname(input));
  loadSnapshot(input);
  if (profile==='minimal') {
    if (!artifactMode) throw new Error('minimal profile requires snapshot directory');
    const {validateMinimal}=await import('./prepare-minimal-launch.mjs');
    validateMinimal(path.dirname(input));
  }
 try {
 const result = spawnSync(process.execPath, [resolveAstroExecutable(), "build"], { cwd: packageRoot, stdio: "inherit", env: { ...process.env, SNAPSHOT_PATH: path.resolve(input), OUTPUT_DIR: path.resolve(output), LEOBLOG_VERSION_MARKER: identity.marker } });
 if (result.status !== 0) throw new Error("Astro build failed");
const routes = profile==='minimal' ? ['/', ...loadSnapshot(input).posts.map((post) => `/posts/${post.slug}`)] : ["/", "/timeline", "/sessions", "/archive", ...loadSnapshot(input).posts.map((post) => `/posts/${post.slug}`), ...loadSnapshot(input).approved.map((item) => `/${item.kind === "session" ? "sessions" : "archive"}/${item.id}`)];
writeManifest(path.resolve(output), routes);
if (artifactMode) {
   const archive = `${outputArg}.tar`;
  const entries = [];
  function collect(dir, prefix = ".") {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = path.join(prefix, entry.name);
      if (entry.isDirectory()) collect(path.join(dir, entry.name), relative);
      else {
        fs.utimesSync(path.join(dir, entry.name), 0, 0);
        entries.push(relative);
      }
    }
  }
  collect(output);
  const listFile = `${outputArg}.entries`;
  fs.writeFileSync(listFile, `${entries.join("\n")}\n`);
  const tar = spawnSync("tar", ["-cf", archive, "-C", output, "-T", listFile], { stdio: "inherit" });
   if (tar.status !== 0) throw new Error("archive build failed");
  const gzip = spawnSync("gzip", ["-n", "-c", archive]);
   if (gzip.status !== 0) throw new Error("artifact compression failed");
   const artifactTemp = `${outputArg}.new`;
   fs.writeFileSync(artifactTemp, gzip.stdout);
   fs.renameSync(artifactTemp, outputArg);
  fs.rmSync(archive, { force: true });
  fs.rmSync(listFile, { force: true });
 }
 } finally {
   if (artifactMode) fs.rmSync(output, { recursive: true, force: true });
 }
}
