import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolveAstroExecutable } from "../scripts/build.mjs";

const root = path.resolve(new URL("..", import.meta.url).pathname);

test("runner resolves the locked local Astro executable and rejects missing dependencies", () => {
  assert.equal(resolveAstroExecutable(root), path.join(root, "node_modules/astro/astro.js"));
  assert.throws(() => resolveAstroExecutable(path.join(os.tmpdir(), "missing-static-site")), /local Astro dependency is missing/);
});

test("artifact runner requires a verified private identity and rejects OUTPUT_DIR mode", (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "leoblog-identity-required-"));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const snapshot = path.join(workspace, "snapshot");
  const artifact = path.join(workspace, "artifact");
  fs.mkdirSync(snapshot);
  fs.copyFileSync(path.join(root, "tests/fixtures/public-snapshot.json"), path.join(snapshot, "public.json"));

  const missing = spawnSync(process.execPath, [path.join(root, "scripts/build.mjs"), snapshot, artifact], {
    encoding: "utf8", env: { ...process.env, ASTRO_TELEMETRY_DISABLED: "1" }
  });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /publication identity/i);
  assert.equal(fs.existsSync(artifact), false);

  const outputDir = spawnSync(process.execPath, [path.join(root, "scripts/build.mjs"), snapshot, artifact], {
    encoding: "utf8", env: { ...process.env, OUTPUT_DIR: path.join(workspace, "outside"), ASTRO_TELEMETRY_DISABLED: "1" }
  });
  assert.notEqual(outputDir.status, 0);
  assert.match(outputDir.stderr, /OUTPUT_DIR.*not supported/i);
});

test("artifact runner rejects every invalid identity before Astro and preserves the existing artifact", (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "leoblog-invalid-identity-"));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const snapshot = path.join(workspace, "snapshot"); const artifact = path.join(workspace, "artifact"); fs.mkdirSync(snapshot);
  fs.copyFileSync(path.join(root, "tests/fixtures/public-snapshot.json"), path.join(snapshot, "public.json"));
  const publicBytes = fs.readFileSync(path.join(snapshot, "public.json")); const manifestBytes = Buffer.from("{}\n"); fs.writeFileSync(path.join(snapshot, "manifest.json"), manifestBytes);
  const valid = { version: 1, generation: 1, content_sha: createHash("sha256").update(publicBytes).digest("hex"), approval_manifest_hash: createHash("sha256").update(manifestBytes).digest("hex") };
  fs.writeFileSync(path.join(snapshot, "publication-identity.json"), JSON.stringify(valid));
  assert.equal(spawnSync(process.execPath, [path.join(root, "scripts/build.mjs"), snapshot, artifact], { encoding: "utf8", env: { ...process.env, ASTRO_TELEMETRY_DISABLED: "1" } }).status, 0);
  const original = fs.readFileSync(artifact);
  const invalid = [
    { ...valid, generation: 0 }, { ...valid, generation: -1 }, { ...valid, generation: 1.5 }, { ...valid, generation: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid, version: 2 }, { ...valid, content_sha: valid.content_sha.toUpperCase() }, { ...valid, content_sha: "x".repeat(64) },
    { ...valid, content_sha: "0".repeat(64) }, { ...valid, approval_manifest_hash: "0".repeat(64) }, { ...valid, extra: true }, { version: 1, generation: 1, content_sha: valid.content_sha }
  ];
  for (const identity of invalid) {
    fs.writeFileSync(path.join(snapshot, "publication-identity.json"), JSON.stringify(identity));
    const result = spawnSync(process.execPath, [path.join(root, "scripts/build.mjs"), snapshot, artifact], { encoding: "utf8", env: { ...process.env, ASTRO_TELEMETRY_DISABLED: "1" } });
    assert.notEqual(result.status, 0, JSON.stringify(identity));
    assert.deepEqual(fs.readFileSync(artifact), original, JSON.stringify(identity));
  }
});

test("runner builds deterministic artifacts with Laravel snapshot cwd and pre-existing tempnam output", (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "leoblog-build-"));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const output = path.join(workspace, ".build-output");
  const inputDir = `${output}-snapshot`;
  fs.mkdirSync(inputDir);
  fs.copyFileSync(path.join(root, "tests/fixtures/public-snapshot.json"), path.join(inputDir, "public.json"));
  const publicBytes = fs.readFileSync(path.join(inputDir, "public.json"));
  const approvalBytes = Buffer.from('{"fixture":"approval"}\n');
  fs.writeFileSync(path.join(inputDir, "manifest.json"), approvalBytes);
  const generation = 1;
  const contentSha = createHash("sha256").update(publicBytes).digest("hex");
  const approvalManifestHash = createHash("sha256").update(approvalBytes).digest("hex");
  const expectedMarker = createHash("sha256").update(`${generation}\n${contentSha}\n${approvalManifestHash}`).digest("hex");
  fs.writeFileSync(path.join(inputDir, "publication-identity.json"), JSON.stringify({ version: 1, generation, content_sha: contentSha, approval_manifest_hash: approvalManifestHash }));
  const legacy = `${output}.static-build`;
  fs.mkdirSync(legacy); fs.writeFileSync(path.join(legacy, "stale-legacy.html"), "legacy");
  const env = { ...process.env, PUBLIC_TURNSTILE_SITE_KEY: "test-key", ASTRO_TELEMETRY_DISABLED: "1" };
  delete env.OUTPUT_DIR;
  const hashes = [];
  for (let run = 0; run < 2; run++) {
    fs.writeFileSync(output, "");
    const result = spawnSync("sh", ["-c", `'${process.execPath}' '${path.join(root, "scripts/build.mjs")}' "$1" "$2"`, "--", inputDir, output], { cwd: inputDir, encoding: "utf8", env });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const artifact = fs.readFileSync(output);
    assert.ok(artifact.length > 0);
    hashes.push(createHash("sha256").update(artifact).digest("hex"));
  }
  assert.equal(hashes[0], hashes[1]);
  t.diagnostic(`two artifact builds SHA-256: ${hashes[0]}`);
  const listing = spawnSync("tar", ["-tzf", output], { encoding: "utf8" });
  assert.equal(listing.status, 0, listing.stderr);
  const entries = listing.stdout.trim().split("\n");
  assert.equal(entries.includes("publication-identity.json"), false);
  assert.equal(entries.includes("stale-legacy.html"), false);
  assert.equal(fs.existsSync(path.join(legacy, "stale-legacy.html")), true);
  assert.ok(entries.includes("404.html"));
  assert.deepEqual(entries.filter((entry) => !entry.endsWith(".js")).sort(), ["404.html", "archive/archive-1/index.html", "archive/index.html", "index.html", "manifest.json", "posts/hello/index.html", "sessions/index.html", "sessions/session-1/index.html", "timeline/index.html"].sort());
  const manifestResult = spawnSync("tar", ["-xOzf", output, "manifest.json"], { encoding: "utf8" });
  assert.equal(manifestResult.status, 0, manifestResult.stderr);
  const manifest = JSON.parse(manifestResult.stdout);
  assert.deepEqual(manifest.routes.filter((route) => !route.endsWith(".js")), ["/", "/archive", "/archive/archive-1", "/posts/hello", "/sessions", "/sessions/session-1", "/timeline"]);
  assert.ok(manifest.files.some((file) => file.path === "/404.html"));
  assert.ok(manifest.files.length >= 7);
  for (const file of manifest.files) {
    const extracted = spawnSync("tar", ["-xOzf", output, file.path.slice(1)]);
    assert.equal(extracted.status, 0);
    assert.equal(extracted.stdout.length, file.size);
    assert.equal(createHash("sha256").update(extracted.stdout).digest("hex"), file.sha256);
    assert.doesNotMatch(extracted.stdout.toString(), /fixture-private-provenance/);
    if (file.path.endsWith(".html")) assert.match(extracted.stdout.toString(), new RegExp(`name="leoblog-version" content="${expectedMarker}"`));
  }
});

test("generation changes marker and artifact when public and approval bytes are unchanged", (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "leoblog-generation-")); t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const snapshot = path.join(workspace, "snapshot"); const artifact = path.join(workspace, "artifact"); fs.mkdirSync(snapshot);
  fs.copyFileSync(path.join(root, "tests/fixtures/public-snapshot.json"), path.join(snapshot, "public.json"));
  const publicBytes = fs.readFileSync(path.join(snapshot, "public.json")); const approvalBytes = Buffer.from("{}\n"); fs.writeFileSync(path.join(snapshot, "manifest.json"), approvalBytes);
  const content_sha = createHash("sha256").update(publicBytes).digest("hex"); const approval_manifest_hash = createHash("sha256").update(approvalBytes).digest("hex");
  const build = generation => { fs.writeFileSync(path.join(snapshot, "publication-identity.json"), JSON.stringify({ version: 1, generation, content_sha, approval_manifest_hash })); const result = spawnSync(process.execPath, [path.join(root, "scripts/build.mjs"), snapshot, artifact], { encoding: "utf8", env: { ...process.env, ASTRO_TELEMETRY_DISABLED: "1" } }); assert.equal(result.status, 0, result.stderr); return { artifact: createHash("sha256").update(fs.readFileSync(artifact)).digest("hex"), html: spawnSync("tar", ["-xOzf", artifact, "index.html"], { encoding: "utf8" }).stdout }; };
  const one = build(1); const two = build(2);
  assert.notEqual(one.artifact, two.artifact);
  assert.notEqual(one.html.match(/leoblog-version" content="([0-9a-f]{64})"/)[1], two.html.match(/leoblog-version" content="([0-9a-f]{64})"/)[1]);
});

test("real Astro output inventories bundled JS assets with byte hashes and no private files", (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "leoblog-real-build-"));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const inputDir = path.join(workspace, "snapshot");
  const output = path.join(workspace, "artifact");
  fs.mkdirSync(inputDir);
  fs.copyFileSync(path.join(root, "tests/fixtures/public-snapshot.json"), path.join(inputDir, "public.json"));
  const publicBytes = fs.readFileSync(path.join(inputDir, "public.json"));
  const approvalBytes = Buffer.from('{"fixture":"approval"}\n');
  fs.writeFileSync(path.join(inputDir, "manifest.json"), approvalBytes);
  fs.writeFileSync(path.join(inputDir, "publication-identity.json"), JSON.stringify({ version: 1, generation: 1, content_sha: createHash("sha256").update(publicBytes).digest("hex"), approval_manifest_hash: createHash("sha256").update(approvalBytes).digest("hex") }));
  const result = spawnSync(process.execPath, [path.join(root, "scripts/build.mjs"), inputDir, output], {
    cwd: inputDir, encoding: "utf8", env: { ...process.env, ASTRO_TELEMETRY_DISABLED: "1" }
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const listing = spawnSync("tar", ["-tzf", output], { encoding: "utf8" });
  assert.equal(listing.status, 0, listing.stderr);
  const entries = listing.stdout.trim().split("\n");
  const js = entries.filter((entry) => entry.endsWith(".js"));
  assert.ok(js.length > 0, `expected bundled JS asset, got: ${entries.join(", ")}`);
  assert.equal(entries.some((entry) => entry.includes("private") || entry.endsWith(".map")), false);
  const manifestResult = spawnSync("tar", ["-xOzf", output, "manifest.json"], { encoding: "utf8" });
  const manifest = JSON.parse(manifestResult.stdout);
  for (const entry of js) {
    const file = manifest.files.find((candidate) => candidate.path === `/${entry}`);
    assert.ok(file, `missing manifest entry for ${entry}`);
    const bytes = spawnSync("tar", ["-xOzf", output, entry]).stdout;
    assert.equal(file.size, bytes.length);
    assert.equal(file.sha256, createHash("sha256").update(bytes).digest("hex"));
    assert.ok(manifest.routes.includes(`/${entry}`));
  }
});

test("rebuild replaces stale routes and a failed build preserves the existing artifact", (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "leoblog-rebuild-"));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const snapshot = path.join(workspace, "snapshot"); const artifact = path.join(workspace, "artifact");
  fs.mkdirSync(snapshot);
  const writeIdentity = () => {
    const publicBytes = fs.readFileSync(path.join(snapshot, "public.json")); const approvalBytes = Buffer.from("{}\n");
    fs.writeFileSync(path.join(snapshot, "manifest.json"), approvalBytes);
    fs.writeFileSync(path.join(snapshot, "publication-identity.json"), JSON.stringify({ version: 1, generation: 1, content_sha: createHash("sha256").update(publicBytes).digest("hex"), approval_manifest_hash: createHash("sha256").update(approvalBytes).digest("hex") }));
  };
  fs.copyFileSync(path.join(root, "tests/fixtures/public-snapshot.json"), path.join(snapshot, "public.json")); writeIdentity();
  let result = spawnSync(process.execPath, [path.join(root, "scripts/build.mjs"), snapshot, artifact], { encoding: "utf8", env: { ...process.env, ASTRO_TELEMETRY_DISABLED: "1" } });
  assert.equal(result.status, 0, result.stderr);
  const original = fs.readFileSync(artifact);
  const updated = JSON.parse(fs.readFileSync(path.join(snapshot, "public.json"), "utf8")); updated.posts = [];
  fs.writeFileSync(path.join(snapshot, "public.json"), JSON.stringify(updated)); writeIdentity();
  result = spawnSync(process.execPath, [path.join(root, "scripts/build.mjs"), snapshot, artifact], { encoding: "utf8", env: { ...process.env, ASTRO_TELEMETRY_DISABLED: "1" } });
  assert.equal(result.status, 0, result.stderr);
  const listing = spawnSync("tar", ["-tzf", artifact], { encoding: "utf8" }).stdout;
  assert.equal(listing.includes("posts/hello/index.html"), false);
  fs.writeFileSync(path.join(snapshot, "publication-identity.json"), "{}");
  result = spawnSync(process.execPath, [path.join(root, "scripts/build.mjs"), snapshot, artifact], { encoding: "utf8", env: { ...process.env, ASTRO_TELEMETRY_DISABLED: "1" } });
  assert.notEqual(result.status, 0);
  assert.notDeepEqual(fs.readFileSync(artifact), original);
  assert.equal(spawnSync("tar", ["-tzf", artifact]).status, 0);
});

test("runner subprocess fails closed without local Astro and never invokes PATH npx", (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "leoblog-missing-deps-"));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  // Copy only the runner and its two imports, never host dependencies or environment files.
  for (const relative of ["scripts/build.mjs", "src/lib/content.mjs", "src/lib/identity.mjs", "src/lib/manifest.mjs"]) {
    const target = path.join(workspace, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, relative), target);
  }
  const input = path.join(workspace, "snapshot");
  fs.mkdirSync(input);
  fs.copyFileSync(path.join(root, "tests/fixtures/public-snapshot.json"), path.join(input, "public.json"));
  const publicBytes = fs.readFileSync(path.join(input, "public.json"));
  const approvalBytes = Buffer.from('{"fixture":"approval"}\n');
  fs.writeFileSync(path.join(input, "manifest.json"), approvalBytes);
  fs.writeFileSync(path.join(input, "publication-identity.json"), JSON.stringify({ version: 1, generation: 1, content_sha: createHash("sha256").update(publicBytes).digest("hex"), approval_manifest_hash: createHash("sha256").update(approvalBytes).digest("hex") }));
  const output = path.join(workspace, ".build-output");
  fs.writeFileSync(output, "");
  const marker = path.join(workspace, "npx-invoked");
  fs.writeFileSync(path.join(workspace, "npx"), `#!/bin/sh\ntouch '${marker}'\nexit 99\n`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${workspace}:${process.env.PATH}` };
  delete env.OUTPUT_DIR;
  const result = spawnSync(process.execPath, [path.join(workspace, "scripts/build.mjs"), input, output], { cwd: input, encoding: "utf8", env });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /local Astro dependency is missing/);
  assert.equal(fs.statSync(output).size, 0);
  assert.equal(fs.existsSync(marker), false);
});
