import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { resolveProfile } from "../src/lib/profile.mjs";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const REQUIRED_MESSAGE = 'LEOBLOG_PROFILE is required: set it to "minimal" or "legacy"';
const UNKNOWN_MESSAGE = 'unknown static profile: LEOBLOG_PROFILE must be "minimal" or "legacy"';

test("resolveProfile requires the variable to be set and rejects an empty string", () => {
  assert.throws(() => resolveProfile({}), (err) => err.message === REQUIRED_MESSAGE);
  assert.throws(() => resolveProfile({ LEOBLOG_PROFILE: "" }), (err) => err.message === REQUIRED_MESSAGE);
});

test("resolveProfile rejects values other than the two known profiles", () => {
  assert.throws(() => resolveProfile({ LEOBLOG_PROFILE: "Minimal" }), (err) => err.message === UNKNOWN_MESSAGE);
  assert.throws(() => resolveProfile({ LEOBLOG_PROFILE: " minimal" }), (err) => err.message === UNKNOWN_MESSAGE);
});

test("resolveProfile returns the two legal values verbatim", () => {
  assert.equal(resolveProfile({ LEOBLOG_PROFILE: "minimal" }), "minimal");
  assert.equal(resolveProfile({ LEOBLOG_PROFILE: "legacy" }), "legacy");
});

test("astro.config.mjs resolves an equivalent config per profile in a subprocess (002/FR-029)", (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "leoblog-profile-config-"));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const probe = path.join(workspace, "probe.mjs");
  const configUrl = new URL("../astro.config.mjs", import.meta.url).href;
  fs.writeFileSync(probe, [
    `import config from ${JSON.stringify(configUrl)};`,
    "process.stdout.write(JSON.stringify({",
    "  output: config.output,",
    "  srcDir: config.srcDir,",
    "  viteIsUndefined: config.vite === undefined,",
    "  vitePublicDir: config.vite ? config.vite.publicDir : null,",
    "  site: config.site,",
    "  buildFormat: config.build ? config.build.format : null,",
    "  outDirIsUndefined: config.outDir === undefined,",
    "}));",
    "",
  ].join("\n"));
  const run = (env) => spawnSync(process.execPath, [probe], { encoding: "utf8", cwd: root, env });

  const minimalEnv = { ...process.env, LEOBLOG_PROFILE: "minimal" };
  delete minimalEnv.OUTPUT_DIR;
  const minimalResult = run(minimalEnv);
  assert.equal(minimalResult.status, 0, minimalResult.stderr);
  const minimalConfig = JSON.parse(minimalResult.stdout);
  assert.equal(minimalConfig.output, "static");
  assert.equal(minimalConfig.srcDir, "./src/minimal");
  assert.equal(minimalConfig.vitePublicDir, false);
  assert.equal(minimalConfig.site, "https://douseful.eu.org");
  assert.equal(minimalConfig.buildFormat, "directory");
  assert.equal(minimalConfig.outDirIsUndefined, true);

  const legacyEnv = { ...process.env, LEOBLOG_PROFILE: "legacy" };
  delete legacyEnv.OUTPUT_DIR;
  const legacyResult = run(legacyEnv);
  assert.equal(legacyResult.status, 0, legacyResult.stderr);
  const legacyConfig = JSON.parse(legacyResult.stdout);
  assert.equal(legacyConfig.output, "static");
  assert.equal(legacyConfig.srcDir, "./src");
  assert.equal(legacyConfig.viteIsUndefined, true);
  assert.equal(legacyConfig.site, "https://leoblog.example.invalid");
  assert.equal(legacyConfig.buildFormat, "directory");
  assert.equal(legacyConfig.outDirIsUndefined, true);

  const unsetEnv = { ...process.env };
  delete unsetEnv.LEOBLOG_PROFILE;
  const unsetResult = run(unsetEnv);
  assert.notEqual(unsetResult.status, 0);
  assert.match(unsetResult.stderr, new RegExp(REQUIRED_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("scripts/build.mjs reports the profile error before validating snapshot input", (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "leoblog-profile-build-order-"));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const missingInput = path.join(workspace, "missing-input");
  const output = path.join(workspace, "out.tar.gz");
  const env = { ...process.env };
  delete env.LEOBLOG_PROFILE;
  const result = spawnSync(process.execPath, [path.join(root, "scripts/build.mjs"), missingInput, output], { encoding: "utf8", env });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, new RegExp(REQUIRED_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(fs.existsSync(output), false);
});
