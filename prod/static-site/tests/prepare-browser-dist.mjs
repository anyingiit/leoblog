import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "leoblog-browser-build-"));
const snapshot = path.join(workspace, "snapshot");
const artifact = path.join(workspace, "artifact.tar");
const packageRoot = path.join(workspace, "site");
fs.mkdirSync(snapshot);
fs.mkdirSync(packageRoot);
for (const relative of ["package.json", "package-lock.json", "astro.config.mjs", "scripts/build.mjs", "scripts/serve.mjs", "src"]) {
  const source = path.join(root, relative);
  const target = path.join(packageRoot, relative);
  if (fs.statSync(source).isDirectory()) fs.cpSync(source, target, { recursive: true });
  else { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(source, target); }
}
fs.symlinkSync(path.join(root, "node_modules"), path.join(packageRoot, "node_modules"), "dir");
fs.copyFileSync(path.join(root, "tests/fixtures/public-snapshot.json"), path.join(snapshot, "public.json"));
const publicBytes = fs.readFileSync(path.join(snapshot, "public.json"));
const approvalBytes = Buffer.from('{"fixture":"approval"}\n');
fs.writeFileSync(path.join(snapshot, "manifest.json"), approvalBytes);
const crypto = await import("node:crypto");
fs.writeFileSync(path.join(snapshot, "publication-identity.json"), JSON.stringify({ version: 1, generation: 1, content_sha: crypto.createHash("sha256").update(publicBytes).digest("hex"), approval_manifest_hash: crypto.createHash("sha256").update(approvalBytes).digest("hex") }));
spawnSync(process.execPath, [path.join(packageRoot, "scripts/build.mjs"), snapshot, artifact], { cwd: snapshot, stdio: "inherit", env: { ...process.env, PUBLIC_TURNSTILE_SITE_KEY: "test-key", ASTRO_TELEMETRY_DISABLED: "1" } });
const dist = path.join(workspace, "dist");
fs.mkdirSync(dist);
spawnSync("tar", ["-xzf", artifact, "-C", dist], { stdio: "inherit" });
const server = spawn(process.execPath, [path.join(packageRoot, "scripts/serve.mjs"), dist], { stdio: "inherit", env: { ...process.env, PUBLIC_TURNSTILE_SITE_KEY: "test-key" } });
process.on("SIGTERM", () => server.kill("SIGTERM"));
process.on("SIGINT", () => server.kill("SIGINT"));
server.on("exit", (code, signal) => { fs.rmSync(workspace, { recursive: true, force: true }); process.exit(code ?? (signal ? 1 : 0)); });
