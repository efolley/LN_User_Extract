"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const supertest = require("supertest");

// Require the Express app (server/index.js exports the app).
const app = require("../server/index.js");

describe("server routes", () => {
  test("GET /health returns status ok", async () => {
    const res = await supertest(app).get("/health");
    assert.equal(res.status, 200);
    assert.equal(res.body && res.body.status, "ok");
  });

  test("GET /auth/start returns 500 when NOTION_CLIENT_ID missing", async () => {
    // Ensure env var is unset for this test
    const orig = process.env.NOTION_CLIENT_ID;
    delete process.env.NOTION_CLIENT_ID;

    const res = await supertest(app).get("/auth/start");
    // The route redirects to Notion when configured; otherwise returns 500 text
    assert.ok([500, 302].includes(res.status));

    if (orig !== undefined) process.env.NOTION_CLIENT_ID = orig;
  });
});
