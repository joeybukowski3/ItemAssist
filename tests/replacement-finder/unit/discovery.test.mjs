import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

test("the proof of concept stays undiscoverable: noindex page, and no nav link, sitemap entry or robots rule", () => {
  assert.match(read("replacement-finder.html"), /<meta name="robots" content="noindex,nofollow">/);
  assert.equal(read("sitemap.xml").includes("replacement-finder"), false, "not in sitemap.xml");
  assert.equal(read("robots.txt").includes("replacement-finder"), false, "no robots.txt rule");

  const linkers = fs.readdirSync(ROOT).filter((name) => /\.(html|js)$/.test(name) && name !== "replacement-finder.html" && name !== "replacement-finder.js")
    .filter((name) => read(name).includes("replacement-finder"));
  assert.deepEqual(linkers, [], "no other page or script links to it");
});

test("vercel.json sends X-Robots-Tag for the page and keeps the API response uncached", () => {
  const config = JSON.parse(read("vercel.json"));
  const rule = (source) => config.headers.find((entry) => entry.source === source);
  assert.deepEqual(rule("/replacement-finder").headers, [{ key: "X-Robots-Tag", value: "noindex, nofollow" }]);
  assert.ok(rule("/api/replacement-finder").headers.some((header) => header.key === "Cache-Control" && header.value === "no-store"));
  assert.equal(config.cleanUrls, true, "existing configuration is preserved");
});

test("the browser code never contains secrets, the engine route, or business scoring logic", () => {
  const browserFiles = ["replacement-finder.js", "assets/js/rf-render.js", "assets/js/rf-shared.js"].map(read).join("\n");
  for (const forbidden of ["ITEMASSIST_REPLACEMENT", "Authorization", "Bearer", "itemassist-replacement", "SERPER", "UPSTASH", "innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval("]) {
    assert.equal(browserFiles.includes(forbidden), false, `browser code must not contain ${forbidden}`);
  }
  assert.ok(read("replacement-finder.js").includes('"/api/replacement-finder"'), "the only endpoint the page calls is the same-origin proxy");
  const httpCalls = browserFiles.match(/https?:\/\/[^"'\s)]+/g) || [];
  assert.deepEqual(httpCalls.filter((url) => !/w3\.org/.test(url)), [], "no external URLs are called from page code");
});

test("the page loads no analytics, tag manager or third-party scripts", () => {
  const html = read("replacement-finder.html");
  assert.equal(/googletagmanager|google-analytics|gtag|<script[^>]+src="https?:/i.test(html), false);
  assert.deepEqual([...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((match) => match[1]), ["assets/js/rf-shared.js", "assets/js/rf-render.js", "replacement-finder.js"]);
});
