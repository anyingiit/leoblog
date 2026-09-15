import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const HASH = /^[0-9a-f]{64}$/;
const MAX_SAFE_GENERATION = Number.MAX_SAFE_INTEGER;

export function markerForIdentity({ generation, content_sha: contentSha, approval_manifest_hash: approvalManifestHash }) {
  return createHash("sha256").update(`${generation}\n${contentSha}\n${approvalManifestHash}`).digest("hex");
}

export function loadPublicationIdentity(snapshotDir) {
  const identityPath = path.join(snapshotDir, "publication-identity.json");
  if (!fs.existsSync(identityPath)) throw new Error("publication identity is required for artifact builds");
  let identity;
  try { identity = JSON.parse(fs.readFileSync(identityPath, "utf8")); }
  catch { throw new Error("publication identity is invalid"); }
  if (!identity || identity.version !== 1 || !Number.isSafeInteger(identity.generation) || identity.generation <= 0 || !HASH.test(identity.content_sha) || !HASH.test(identity.approval_manifest_hash) || Object.keys(identity).sort().join(",") !== "approval_manifest_hash,content_sha,generation,version") {
    throw new Error("publication identity is invalid");
  }
  if (identity.generation > MAX_SAFE_GENERATION) throw new Error("publication identity generation is invalid");
  const publicPath = path.join(snapshotDir, "public.json");
  const manifestPath = path.join(snapshotDir, "manifest.json");
  if (!fs.existsSync(publicPath) || !fs.existsSync(manifestPath)) throw new Error("publication identity source files are required");
  const contentSha = createHash("sha256").update(fs.readFileSync(publicPath)).digest("hex");
  const approvalManifestHash = createHash("sha256").update(fs.readFileSync(manifestPath)).digest("hex");
  if (contentSha !== identity.content_sha || approvalManifestHash !== identity.approval_manifest_hash) throw new Error("publication identity hashes do not match source files");
  return { ...identity, marker: markerForIdentity(identity) };
}
