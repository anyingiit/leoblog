import fs from "node:fs";
import crypto from "node:crypto";

const topKeys = new Set(["version", "git_sha", "posts", "timeline", "media", "approved"]);
const postKeys = new Set(["slug", "title", "summary", "tags", "published_at", "body", "sha"]);
const eventKeys = new Set(["track", "col", "title", "status", "desc", "link"]);
const mediaKeys = new Set(["object_key", "content_type", "size", "sha256"]);
const approvedKeys = new Set(["kind", "id", "data"]);

function only(object, keys, label) {
  if (!object || typeof object !== "object" || Array.isArray(object)) throw new Error(`${label} must be an object`);
  const unknown = Object.keys(object).filter((key) => !keys.has(key));
  if (unknown.length) throw new Error(`${label} contains unknown fields: ${unknown.join(",")}`);
}
function string(value, label) { if (typeof value !== "string") throw new Error(`${label} must be a string`); return value; }
function safeSlug(value, label) { string(value, label); if (!/^[A-Za-z0-9_.-]+$/.test(value) || value === "." || value === "..") throw new Error(`${label} is unsafe`); return value; }

export function loadSnapshot(rawOrPath, expectedContentSha = "") {
  const raw = typeof rawOrPath === "string" && rawOrPath.trim().startsWith("{") ? rawOrPath : fs.readFileSync(rawOrPath, "utf8");
  if (expectedContentSha && !/^[a-f0-9]{64}$/.test(expectedContentSha)) throw new Error("invalid expected content hash");
  if (expectedContentSha && crypto.createHash("sha256").update(raw).digest("hex") !== expectedContentSha) throw new Error("snapshot content hash mismatch");
  const snapshot = JSON.parse(raw);
  only(snapshot, topKeys, "snapshot");
  if (snapshot.version !== 1 || !Array.isArray(snapshot.posts) || !snapshot.timeline || !Array.isArray(snapshot.media) || !Array.isArray(snapshot.approved)) throw new Error("invalid snapshot shape");
  snapshot.posts.forEach((post, i) => { only(post, postKeys, `post ${i}`); safeSlug(post.slug, `post ${i}.slug`); ["title", "summary", "body"].forEach((k) => string(post[k], `post ${i}.${k}`)); if (!Array.isArray(post.tags) || post.tags.some((x) => typeof x !== "string")) throw new Error(`post ${i}.tags invalid`); });
  if (!Array.isArray(snapshot.timeline.events)) throw new Error("timeline.events invalid");
  snapshot.timeline.events.forEach((event, i) => { only(event, eventKeys, `timeline event ${i}`); for (const key of ["track", "title", "status", "desc"]) if (key in event && typeof event[key] !== "string") throw new Error(`timeline event ${i}.${key} invalid`); if ("col" in event && !Number.isInteger(event.col)) throw new Error(`timeline event ${i}.col invalid`); });
  snapshot.media.forEach((media, i) => { only(media, mediaKeys, `media ${i}`); if (!/^media\/immutable\/[a-f0-9]{64}$/.test(media.object_key) || !/^[a-f0-9]{64}$/.test(media.sha256)) throw new Error(`media ${i} immutable key invalid`); if (!Number.isInteger(media.size) || typeof media.content_type !== "string") throw new Error(`media ${i} invalid`); });
  snapshot.approved.forEach((item, i) => { only(item, approvedKeys, `approved ${i}`); if (!['session', 'archive'].includes(item.kind)) throw new Error(`approved ${i} kind invalid`); safeSlug(String(item.id), `approved ${i}.id`); if (!item.data || typeof item.data !== "object" || Array.isArray(item.data)) throw new Error(`approved ${i}.data invalid`); if (Object.keys(item.data).some((key) => /email|token|private|raw|transcript/i.test(key))) throw new Error(`approved ${i} contains private field`); });
  return snapshot;
}


export function snapshotToSite(snapshot) {
  const loaded = loadSnapshot(JSON.stringify(snapshot));
  return { posts: loaded.posts.map(({ sha, ...post }) => post), timeline: loaded.timeline, media: loaded.media, approved: loaded.approved };
}
export function getSnapshot() { return loadSnapshot(process.env.SNAPSHOT_PATH || "snapshot.json"); }
export function markdownToHtml(markdown) {
  const escape = (value) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return escape(markdown).split(/\r?\n\r?\n/).map((part) => { const h = part.match(/^(#{1,6})\s+(.+)$/s); if (h) { const level = h[1].length; return `<h${level}>${h[2]}</h${level}>`; } return `<p>${part.replace(/\r?\n/g, "<br />")}</p>`; }).join("\n");
}
