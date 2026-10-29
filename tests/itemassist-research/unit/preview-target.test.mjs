import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { resolvePreviewTarget, LOCAL_PORT } = require("../preview/preview-target.js");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

test("a hosted Preview origin on *.vercel.app is accepted (and normalised to its origin)", () => {
  for (const url of ["https://itemassist-git-feat-itemassist-workspace-ui-joeybs-projects-251953f7.vercel.app", "https://itemassist-abc123xyz-joeybs-projects-251953f7.vercel.app/"]) {
    const target = resolvePreviewTarget({ PREVIEW_URL: url });
    assert.equal(target.local, false);
    assert.equal(target.baseURL, new URL(url).origin);
  }
});

test("anything else is refused: no URL, other schemes, credentials, paths, queries, custom or production domains", () => {
  const refused = ["", "not a url", "http://x.vercel.app", "ftp://x.vercel.app", "https://user:pw@x.vercel.app", "https://x.vercel.app/replacement-finder", "https://x.vercel.app/?x-vercel-protection-bypass=abc",
    "https://x.vercel.app/#frag", "https://itemassist.com", "https://www.itemassist.com", "https://itemassist.vercel.app", "https://evil.example.com", "https://vercel.app.evil.com", "https://localhost:3000"];
  for (const url of refused) assert.throws(() => resolvePreviewTarget({ PREVIEW_URL: url }), /Preview target:/, JSON.stringify(url));
});

test("local self-test mode is explicit: PREVIEW_LOCAL=1 with no PREVIEW_URL only, and an explicit PREVIEW_URL still wins and is still checked", () => {
  assert.deepEqual(resolvePreviewTarget({ PREVIEW_LOCAL: "1" }), { baseURL: `http://localhost:${LOCAL_PORT}`, local: true });
  assert.throws(() => resolvePreviewTarget({ PREVIEW_LOCAL: "true" }), /PREVIEW_URL is not set/);
  assert.throws(() => resolvePreviewTarget({ PREVIEW_LOCAL: "1", PREVIEW_URL: "https://itemassist.com" }), /production host/);
});

test("the bypass secret is never part of a target or an error message", () => {
  const secret = "s3cr3t-bypass-value-0123456789";
  for (const env of [{ PREVIEW_URL: `https://x.vercel.app/?bypass=${secret}`, VERCEL_AUTOMATION_BYPASS_SECRET: secret }, { VERCEL_AUTOMATION_BYPASS_SECRET: secret }, { PREVIEW_URL: "https://evil.com", VERCEL_AUTOMATION_BYPASS_SECRET: secret }]) {
    try { resolvePreviewTarget(env); assert.fail("expected a refusal"); } catch (error) { assert.equal(error.message.includes(secret), false); }
  }
  assert.equal(JSON.stringify(resolvePreviewTarget({ PREVIEW_URL: "https://x.vercel.app", VERCEL_AUTOMATION_BYPASS_SECRET: secret })).includes(secret), false);
});

test("the Preview test files only read the bypass secret from the environment: never printed, templated into a URL, stored, or recorded", () => {
  const files = ["tests/itemassist-research/preview/playwright.preview.config.js", "tests/itemassist-research/preview/preview-research.spec.js", "tests/itemassist-research/preview/preview-target.js"];
  for (const file of files) {
    const source = read(file);
    assert.equal(/console\.(?:log|info|warn|error)/.test(source), false, `${file} must not print`);
    // Only the spec reads the secret, and only through one named constant; the config and the target guard never touch it.
    const reads = (source.match(/process\.env\[BYPASS\]|process\.env\.VERCEL_AUTOMATION_BYPASS_SECRET/g) || []).length;
    assert.equal(reads, file.endsWith("preview-research.spec.js") ? 1 : 0, `${file} reads the secret ${reads} time(s)`);
    assert.equal(/x-vercel-protection-bypass=|[?&]x-vercel-set-bypass-cookie/.test(source), false, `${file} must not put the secret in a URL`);
    assert.equal(/\bwriteFile|appendFile|localStorage|sessionStorage/.test(source), false, `${file} must not store it`);
  }
  const config = read("tests/itemassist-research/preview/playwright.preview.config.js");
  assert.match(config, /trace: "off"/, "traces record request headers, so they stay off");
  assert.equal(/extraHTTPHeaders/.test(config), false, "a context-wide header would send the secret to third-party hosts");
  const spec = read("tests/itemassist-research/preview/preview-research.spec.js");
  assert.match(spec, /headers: \{ "x-vercel-protection-bypass": secret/, "the secret goes only in the one request to the Preview origin");
  const pkg = read("package.json");
  assert.equal(/BYPASS|SECRET/i.test(pkg), false, "package.json holds no secret");
  assert.match(read(".gitignore"), /^\.env$/m);
});

test("the Preview tests mock the API in the browser and refuse any other API call; they need no backend, Redis or provider", () => {
  const spec = read("tests/itemassist-research/preview/preview-research.spec.js");
  assert.match(spec, /page\.route\("\*\*\/api\/\*\*"/, "a catch-all refuses unmocked API calls");
  assert.match(spec, /expect\(seen\.unmocked/, "and fails the test if one happens");
  for (const forbidden of ["GEMINI", "SERPER", "UPSTASH", "ITEMASSIST_REPLACEMENT_API_TOKEN", "Authorization", "Bearer"]) assert.equal(spec.includes(forbidden), false, forbidden);
  assert.equal(/ITEMASSIST_RESEARCH_ENABLED/.test(spec.replace(/\/\/.*$/gm, "")), false, "the spec never sets or reads the real flag");
});
