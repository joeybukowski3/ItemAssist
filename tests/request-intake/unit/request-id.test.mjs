import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { generateRequestId } = require("../../../api/lib/age-verification/request-id.js");

test("generateRequestId matches the IAV-YYYYMMDD-XXXXXXXX format", () => {
  const id = generateRequestId(new Date("2026-03-01T00:00:00Z"));
  assert.match(id, /^IAV-20260301-[0-9A-F]{8}$/);
});

test("generateRequestId is highly unlikely to collide across many calls", () => {
  const ids = new Set();
  for (let i = 0; i < 5000; i++) {
    ids.add(generateRequestId(new Date("2026-03-01T00:00:00Z")));
  }
  assert.equal(ids.size, 5000);
});
