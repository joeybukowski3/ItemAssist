import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../");
// Every script the workspace page loads for the research tool, in load order.
const BROWSER_SCRIPTS = ["assets/js/rf-shared.js", "assets/js/rf-intake.js", "assets/js/rf-dom.js", "assets/js/rf-replacement.js", "assets/js/rf-product.js", "assets/js/rf-research.js", "assets/js/rf-research-price-view.js", "assets/js/rf-research-view.js", "assets/js/rf-assistant.js", "replacement-finder.js"];
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

test("the research workspace is the public homepage: indexable, canonical, in the sitemap, and the old workspace URL redirects to it", () => {
  const home = read("index.html");
  assert.equal(/<meta name="robots"/.test(home), false, "no noindex on the homepage");
  assert.match(home, /<link rel="canonical" href="https:\/\/itemassist\.com\/">/);
  assert.match(home, /<h1 id="rf-assistant-h"[^>]*>Product Identification &amp; Market Pricing Research<\/h1>/);
  assert.equal(fs.existsSync(path.join(ROOT, "replacement-finder.html")), false, "the old page file is gone");
  assert.ok(read("sitemap.xml").includes("<loc>https://itemassist.com/</loc>"));
  assert.equal(read("sitemap.xml").includes("replacement-finder"), false);
  assert.equal(/^\s*Disallow:/im.test(read("robots.txt")), false, "retired URLs stay crawlable so crawlers can follow their redirects");
  const redirect = JSON.parse(read("vercel.json")).redirects.find((entry) => entry.source === "/replacement-finder");
  assert.deepEqual(redirect, { source: "/replacement-finder", destination: "/", permanent: false });
});

test("vercel.json keeps the API response uncached and noindex, and keeps clean URLs", () => {
  const config = JSON.parse(read("vercel.json"));
  const rule = (source) => config.headers.find((entry) => entry.source === source);
  assert.ok(rule("/api/replacement-finder").headers.some((header) => header.key === "Cache-Control" && header.value === "no-store"));
  assert.ok(rule("/api/replacement-finder").headers.some((header) => header.key === "X-Robots-Tag" && header.value === "noindex, nofollow"));
  assert.equal(config.cleanUrls, true, "existing configuration is preserved");
});

test("the browser code never contains secrets, the engine route, or business scoring logic", () => {
  const browserFiles = BROWSER_SCRIPTS.map(read).join("\n");
  for (const forbidden of ["ITEMASSIST_REPLACEMENT", "Authorization", "Bearer", "itemassist-replacement", "SERPER", "UPSTASH", "innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval("]) {
    assert.equal(browserFiles.includes(forbidden), false, `browser code must not contain ${forbidden}`);
  }
  assert.ok(read("replacement-finder.js").includes('"/api/replacement-finder"'), "the only endpoint the research page code calls is the same-origin proxy");
  const httpCalls = browserFiles.match(/https?:\/\/[^"'\s)]+/g) || [];
  assert.deepEqual(httpCalls.filter((url) => !/w3\.org/.test(url)), [], "no external URLs are called from page code");
});

test("the homepage's scripts are the research tool, the composer-dock helper, the contact form and Cloudflare Turnstile, and it loads no analytics", () => {
  const html = read("index.html");
  const sources = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(sources, ["https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit", ...BROWSER_SCRIPTS, "assets/js/rf-contact-dock.js", "consultation.js"]);
  assert.equal(/googletagmanager|google-analytics|gtag/i.test(html), false, "the workspace page carries no analytics or tag manager");
});
