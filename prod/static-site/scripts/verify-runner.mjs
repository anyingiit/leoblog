import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "leoblog-runner-verify-"));
try {
  // Explicit public-source allowlist: no host dependencies, dotfiles, or credentials.
  const files = [
    "package.json", "package-lock.json", "astro.config.mjs",
    "scripts/build.mjs",
    "src/lib/api.mjs", "src/lib/content.mjs", "src/lib/identity.mjs", "src/lib/manifest.mjs", "src/lib/profile.mjs",
    "src/layouts/Layout.astro", "src/components/CommentIsland.astro", "src/scripts/comments.js",
    "src/pages/index.astro", "src/pages/404.astro", "src/pages/timeline.astro", "src/pages/posts/[slug].astro",
    "src/pages/sessions/index.astro", "src/pages/sessions/[id].astro",
    "src/pages/archive/index.astro", "src/pages/archive/[slug].astro",
    "tests/api.test.mjs", "tests/content.test.mjs", "tests/manifest.test.mjs", "tests/build.test.mjs", "tests/profile.test.mjs",
    "tests/fixtures/public-snapshot.json",
    "scripts/prepare-minimal-launch.mjs", "scripts/serve-minimal.mjs",
    "scripts/article-registry.mjs", "scripts/approvals.mjs",
    "src/minimal/layouts/Layout.astro", "src/minimal/pages/index.astro",
    "src/minimal/pages/404.astro", "src/minimal/pages/posts/[slug].astro",
    "src/minimal/discovery.mjs", "src/minimal/pages/sitemap.xml.js", "src/minimal/pages/robots.txt.js",
    "tests/package-copy.mjs",
    "tests/minimal-launch.test.mjs",
    "tests/minimal-multi.test.mjs",
    "tests/minimal-content.test.mjs",
    "tests/minimal-preview.test.mjs",
    "tests/security-toolchain.test.mjs",
    "tests/article-registry.test.mjs", "tests/approvals.test.mjs",
  ];
  // content/minimal-launch/ is inventoried at runtime (not listed above) so
  // that adding an article never requires touching this runner (002/SC-005).
  const contentDir = path.join(root, "content/minimal-launch");
  for (const name of fs.readdirSync(contentDir).sort()) {
    const entryPath = path.join(contentDir, name);
    if (!/^[A-Za-z0-9._-]+$/.test(name) || !fs.lstatSync(entryPath).isFile()) {
      throw new Error(`unexpected content entry: content/minimal-launch/${name}`);
    }
    files.push(`content/minimal-launch/${name}`);
  }
  for (const relative of files) {
    const source = path.join(root, relative);
    if (!fs.lstatSync(source).isFile()) throw new Error(`expected regular source file: ${relative}`);
    const target = path.join(workspace, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
  fs.symlinkSync(path.join(root, "node_modules"), path.join(workspace, "node_modules"), "dir");
  const tests = files.filter((file) => file.endsWith(".test.mjs")).map((file) => path.join(workspace, file));
  const result = spawnSync(process.execPath, ["--test", ...tests], { cwd: workspace, stdio: "inherit" });
  process.exitCode = result.status ?? 1;
} finally {
  fs.rmSync(workspace, { recursive: true, force: true });
}
