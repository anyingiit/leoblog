import { test, expect } from "@playwright/test";

test("static post remains usable offline and safely renders API comments", async ({ page }) => {
  const submissions = [];
  await page.route("**/api/public/comments?post=hello", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: [{ author_name: "<b>safe</b>", body: "<img src=x onerror=alert(1)>" }] }) }));
  await page.route("**/api/public/comments", (route) => { submissions.push(route.request().postDataJSON()); return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ data: { id: "comment-1", status: "pending", withdrawal_token: "withdraw-once" } }) }); });
  await page.goto("/posts/hello");
  await expect(page.locator("#comment-list")).toContainText("<b>safe</b>");
  expect(await page.locator("#comment-list img").count()).toBe(0);
  await page.locator("#comment-author").fill("A"); await page.locator("#comment-body").fill("Hello"); await page.locator("#comment-form button").click();
  await expect(page.locator("#comment-status")).toContainText("Submitted");
  expect(submissions).toEqual([{ post_slug: "hello", author_name: "A", body: "Hello", turnstile_token: "" }]);
});

test("valid Turnstile callback enables submission and withdrawal token is POST-only", async ({ page }) => {
  await page.route("**/api/public/comments?post=hello", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: [] }) }));
  await page.route("**/api/public/comments", (route) => route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ data: { id: "comment-1", status: "pending", withdrawal_token: "withdraw-once" } }) }));
  await page.route("**/api/public/comments/comment-1/withdraw", (route) => { expect(route.request().postDataJSON()).toEqual({ withdrawal_token: "withdraw-once" }); return route.fulfill({ status: 204 }); });
  await page.goto("/posts/hello");
  await page.locator("#comment-author").fill("A"); await page.locator("#comment-body").fill("Hello"); await page.locator("#comment-form button").click();
  await expect(page.locator("#withdrawal")).toBeVisible(); await page.locator("#withdraw-form button").click(); await expect(page.locator("#withdraw-status")).toContainText("withdrawn");
});

test("resets Turnstile after submit and obtains a fresh token for the second submission", async ({ page }) => {
  const submissions = [];
  await page.addInitScript(() => {
    window.__turnstile = { renders: 0, resets: 0 };
    window.turnstile = { render: (_element, options) => { window.__turnstile.options = options; window.__turnstile.renders += 1; return "widget-1"; }, reset: (id) => { window.__turnstile.resets += 1; window.__turnstile.options.callback(`fresh-${window.__turnstile.resets}`); } };
  });
  await page.route("**/api/public/comments?post=hello", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: [] }) }));
  await page.route("**/api/public/comments", (route) => { submissions.push(route.request().postDataJSON()); return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ data: { id: "comment-1", withdrawal_token: "withdraw-once" } }) }); });
  await page.goto("/posts/hello");
  await page.waitForFunction(() => window.__turnstile?.options);
  await page.evaluate(() => window.__turnstile.options.callback("token-one"));
  await page.locator("#comment-author").fill("A"); await page.locator("#comment-body").fill("One"); await page.locator("#comment-form button").click();
  await expect(page.locator("#comment-status")).toContainText("Submitted");
  await page.locator("#comment-author").fill("B"); await page.locator("#comment-body").fill("Two"); await page.locator("#comment-form button").click();
  await expect(page.locator("#comment-status")).toContainText("Submitted");
  expect(submissions.map((submission) => submission.turnstile_token)).toEqual(["token-one", "fresh-1"]);
  expect(await page.evaluate(() => window.__turnstile.resets)).toBe(2);
});
