export function createCommentsClient(fetcher = fetch, endpoint = "/api/public/comments") {
  return {
    async list(slug) { const response = await fetcher(`${endpoint}?post=${encodeURIComponent(slug)}`); if (!response.ok) throw new Error("comments_unavailable"); return response.json(); },
    async submit(input) { const body = { post_slug: input.post_slug, author_name: input.author_name, body: input.body, turnstile_token: input.turnstile_token }; const response = await fetcher(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const json = await response.json().catch(() => ({})); if (!response.ok) throw Object.assign(new Error(json.message || "comment_failed"), { code: json.code }); return json; },
    async withdraw(commentId, withdrawalToken) { const response = await fetcher(`${endpoint}/${encodeURIComponent(commentId)}/withdraw`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ withdrawal_token: withdrawalToken }) }); if (!response.ok) throw new Error("comment_not_found"); return response; },
  };
}
