// The public surface of the AI-only site (see docs/ai-only-mode.md): which pages exist, where retired routes go, what the metadata,
// sitemap and structured data say, and that every local link and asset resolves. Static checks only: no server, network or provider.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const exists = (file) => fs.existsSync(path.join(ROOT, file));

const PUBLIC_PAGES = ["index.html", "privacy.html", "404.html"];
const RETIRED_ROUTES = ["about", "services", "report", "request-age-verification", "what-does-lkq-mean-contents-claims", "discontinued-av-receiver-replacement-research", "replacement-finder"];
// Wording that belongs to the commercial offering, not the AI research tool.
const COMMERCIAL = /insur|adjuster|claim|policyholder|\bLKQ\b|contents (?:pricing|research|inventory)|per[- ]claim|starting at|outsourc|sample report|\bRCV\b|\bACV\b|replacement cost value|actual cash value|free consultation/i;
const text = (html) => html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ");

test("only the research homepage, the privacy policy and the 404 page are public HTML pages", () => {
  const pages = fs.readdirSync(ROOT).filter((name) => name.endsWith(".html")).sort();
  assert.deepEqual(pages, ["404.html", "index.html", "privacy.html"]);
});

test("the retired commercial pages, their scripts, images and PDFs are not deployed", () => {
  for (const file of ["about.html", "services.html", "report.html", "request-age-verification.html", "request-age-verification.js", "what-does-lkq-mean-contents-claims.html", "discontinued-av-receiver-replacement-research.html", "replacement-finder.html", "script.js", "assets/og-image.png", "assets/report-preview.png", "screenshot1.jpg", "screenshot2.jpg", "screenshot3.jpg"]) {
    assert.equal(exists(file), false, `${file} must not be deployed`);
  }
  const deployed = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const relative = path.posix.join(dir, entry.name);
      if (entry.isDirectory()) { if (!["node_modules", "tests", "docs", "api", ".git", ".vercel", "test-results"].includes(entry.name)) walk(relative); }
      else deployed.push(relative);
    }
  };
  walk(".");
  assert.deepEqual(deployed.filter((file) => /\.pdf$/i.test(file)), [], "no public PDF");
  assert.deepEqual(deployed.filter((file) => /sample|report/i.test(path.basename(file))), [], "no sample-report asset");
});

test("every retired route, with and without .html, redirects temporarily to the homepage; APIs and assets are never redirected", () => {
  const config = JSON.parse(read("vercel.json"));
  const redirects = new Map(config.redirects.map((entry) => [entry.source, entry]));
  for (const route of RETIRED_ROUTES) {
    for (const source of [`/${route}`, `/${route}.html`]) {
      assert.deepEqual(redirects.get(source), { source, destination: "/", permanent: false }, source);
    }
  }
  assert.equal(config.redirects.length, RETIRED_ROUTES.length * 2, "no other redirect");
  for (const entry of config.redirects) assert.equal(/^\/(api|assets)(\/|$)/.test(entry.source) || /[*(:]/.test(entry.source), false, `${entry.source} is an exact page route`);
  assert.equal(config.cleanUrls, true);
});

test("the sitemap lists only pages that exist and are public, and robots.txt leaves retired URLs crawlable so their redirects are seen", () => {
  const urls = [...read("sitemap.xml").matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  assert.deepEqual(urls, ["https://itemassist.com/", "https://itemassist.com/privacy"]);
  assert.match(read("robots.txt"), /^Sitemap: https:\/\/itemassist\.com\/sitemap\.xml$/m);
  assert.equal(/^\s*Disallow:/im.test(read("robots.txt")), false);
});

test("public copy, titles, descriptions, social tags and structured data carry no insurance or commercial-service wording", () => {
  for (const page of PUBLIC_PAGES) {
    const html = read(page);
    assert.doesNotMatch(text(html), COMMERCIAL, `${page} visible text`);
    for (const match of html.matchAll(/<(?:title|meta)\b[^>]*>(?:[^<]*<\/title>)?/gi)) assert.doesNotMatch(match[0], COMMERCIAL, `${page} ${match[0]}`);
    for (const match of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      assert.doesNotThrow(() => JSON.parse(match[1]), `${page} structured data parses`);
      assert.doesNotMatch(match[1], COMMERCIAL, `${page} structured data`);
    }
  }
  assert.doesNotMatch(read("consultation.js").replace(/\/\*[\s\S]*?\*\//g, ""), /insur|adjuster|claim/i);
});

test("the homepage metadata presents the research workspace", () => {
  const html = read("index.html");
  const title = "Product Identification &amp; Market Pricing Research | Item Assist";
  const description = "Research products, compare replacement options, and explore relevant specifications and pricing information through a conversational research workspace.";
  assert.ok(html.includes(`<title>${title}</title>`));
  for (const tag of ['<meta name="description"', '<meta property="og:description"', '<meta name="twitter:description"']) assert.ok(html.includes(`${tag} content="${description}"`), tag);
  for (const tag of ['<meta property="og:title"', '<meta name="twitter:title"']) assert.ok(html.includes(`${tag} content="${title}"`), tag);
  assert.ok(html.includes('<meta property="og:image" content="https://itemassist.com/assets/og-research.png">'));
  assert.ok(html.includes('<meta name="twitter:image" content="https://itemassist.com/assets/og-research.png">'));
  assert.ok(exists("assets/og-research.png"));
  for (const page of PUBLIC_PAGES) assert.equal(read(page).includes("og-image.png"), false, `${page} no longer points at the commercial preview image`);
});

test("no public page links to a retired route, and no script names one as a destination", () => {
  const routes = RETIRED_ROUTES.join("|");
  const link = new RegExp(`(?:href|action)=["'](?:https://itemassist\\.com)?/(?:${routes})(?:\\.html)?(?:[#?][^"']*)?["']`, "i");
  for (const page of PUBLIC_PAGES) assert.doesNotMatch(read(page), link, page);
  // A quoted route on its own ("/report"). The proxy paths ("/api/replacement-finder") do not match because "api" precedes the slash.
  const destination = new RegExp(`["'\`](?:https://itemassist\\.com)?/(?:${routes})(?:\\.html)?(?:[#?][^"'\`]*)?["'\`]`);
  for (const file of ["consultation.js", "replacement-finder.js", ...fs.readdirSync(path.join(ROOT, "assets/js")).map((name) => `assets/js/${name}`)]) {
    assert.doesNotMatch(read(file), destination, file);
  }
});

test("every local link, script, stylesheet and image of the public pages resolves to a deployed file or an in-page anchor", () => {
  for (const page of PUBLIC_PAGES) {
    const html = read(page);
    const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
    for (const match of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
      const target = match[1];
      if (/^(?:https?:|mailto:|tel:|data:)/.test(target) && !/^https:\/\/itemassist\.com/.test(target)) continue;
      if (target.startsWith("#")) { assert.ok(ids.has(target.slice(1)), `${page}: ${target} anchor`); continue; }
      const local = target.replace(/^https:\/\/itemassist\.com/, "").split(/[?#]/)[0] || "/";
      const file = local === "/" ? "index.html" : local.replace(/^\//, "");
      assert.ok(exists(file) || exists(`${file}.html`), `${page}: ${target} does not resolve`);
    }
  }
});

test("the contact form's inquiry types are the three requested, with no payment or checkout control", () => {
  const html = read("index.html");
  const options = [...html.matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g)].map((match) => [match[1], match[2]]);
  assert.deepEqual(options, [["", "Choose one&hellip;"], ["human_research", "Request Human-Reviewed Research"], ["paid_access", "Ask About Additional or Paid Access"], ["general_question", "General Question"]]);
  assert.equal(/checkout|stripe|subscribe|add to cart|payment/i.test(text(html).replace(/payment details/i, "")), false);
  assert.equal(/stripe|checkout/i.test(html), false);
});
