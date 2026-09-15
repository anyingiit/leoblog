import test from "node:test";
import assert from "node:assert/strict";
import { createCommentsClient } from "../src/lib/api.mjs";

test("comments client fetches approved comments and submits only the frozen body", async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 201, json: async () => ({ data: { status: "pending", withdrawal_token: "once" } }) };
  };
  const client = createCommentsClient(fetcher, "/api/public/comments");
  await client.list("hello");
  const response = await client.submit({ post_slug: "hello", author_name: "A", body: "Hi", turnstile_token: "cf-token", author_email: "must-not-send" });
  assert.equal(response.data.status, "pending");
  assert.deepEqual(JSON.parse(calls[1].options.body), { post_slug: "hello", author_name: "A", body: "Hi", turnstile_token: "cf-token" });
});

test("comments client preserves Laravel error code without exposing response internals", async () => {
  const client = createCommentsClient(async () => ({ ok: false, status: 422, json: async () => ({ code: "validation_failed", message: "invalid comment", request_id: "req_fixture_01", private: "no" }) }));
  await assert.rejects(() => client.submit({ post_slug: "hello", author_name: "A", body: "", turnstile_token: "token" }), (error) => error.code === "validation_failed" && error.message === "invalid comment" && !error.private);
});
