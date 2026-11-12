const { safeSourceUrl } = require("./sources");

/**
 * The original product's own manufacturer page, as the engine may carry it (`original.manufacturerPages`, optional). This side re-derives every field from
 * the address and never trusts the payload's name, domain or class, mirroring the engine's own check (which also matches the person's words, something only
 * the engine has): a page is kept only when
 *   - its address is a registered MANUFACTURER host's, returned exactly as the registry normalizes it, on the maker's US storefront;
 *   - the address carries exactly one model code, and the page's `model` is that code;
 *   - the maker is the original's own maker (its name appears in the identification);
 *   - `pageKind`, `foundVia` and the key set are exactly what the engine writes, and the title is plain text without a price, link or assurance.
 * What a page establishes is that the maker lists that model. It is never a source of specifications or prices, never opened, and never evidence about a
 * successor: nothing here reaches the pricing, evidence or candidates.
 */

const MAX_PAGES = 2;
const MAX_TITLE = 120;
const US_PREFIX_HOSTS = Object.freeze(["lg.com", "samsung.com", "bosch-home.com", "tcl.com"]);
const US_ONLY_HOSTS = Object.freeze(["geappliances.com", "whirlpool.com", "maytag.com", "kitchenaid.com", "frigidaire.com", "subzero-wolf.com", "hisense-usa.com", "vizio.com", "insigniaproducts.com"]);
const REGION_SEGMENTS = new Set(["in", "uk", "ca", "au", "nz", "ie", "de", "fr", "es", "it", "nl", "be", "at", "ch", "se", "no", "dk", "fi", "pl", "pt", "gr", "tr", "ru", "ae", "sa", "za", "levant", "africa", "global", "latin", "mx", "br", "ar", "cl", "co", "pe", "my", "sg", "ph", "th", "vn", "id", "jp", "kr", "cn", "tw", "hk"]);
const SUPPORT_PATH = /support|owner-center|manual/i;
// Pages that mention a model without being its product or support page, and locale or country markers of a regional page.
const NOT_A_PAGE_OF_THE_MODEL = /blog|news|press|review|accessor|compar|parts|deal|mount|discover|article|stor(?:y|ies)|video|buying-guide|inspiration/i;
const LOCALE_SEGMENT = /^[a-z]{2}[-_][a-z]{2}$/i;
const COUNTRY_SUFFIX = /[-_](?:ca|mx|uk|au|nz|in|br|de|fr|es|it)$/i;
const KEYS = Object.freeze(["url", "domain", "sourceName", "sourceClass", "model", "pageKind", "title", "foundVia"]);

const segments = (pathname) => String(pathname).split("/").filter(Boolean);
const tokensOf = (text) => String(text).toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
const sameAddress = (a, b) => a.replace(/\/$/, "") === b.replace(/\/$/, "");
const pageKindOf =(pathname) => (SUPPORT_PATH.test(pathname) ? "SUPPORT" : "PRODUCT");

function isUsStorefront(domain, pathname) {
  const first = (segments(pathname)[0] || "").toLowerCase();
  if (US_PREFIX_HOSTS.includes(domain)) return first === "us";
  if (US_ONLY_HOSTS.includes(domain)) {
    const regional = REGION_SEGMENTS.has(first) || (LOCALE_SEGMENT.test(first) && first.toLowerCase() !== "en-us") || segments(pathname).some((part) => COUNTRY_SUFFIX.test(part));
    return !regional;
  }
  return false;
}

/**
 * @param {unknown} raw  the engine's `original.manufacturerPages`
 * @param {{identity: string|null, safeText: Function, modelRelation: Function, modelPattern: RegExp}} context  the projection's own helpers and the cleaned identification
 * @returns {object[]} the pages that survive, product pages first, at most two, never repaired
 */
function projectManufacturerPages(raw, { identity, safeText, modelRelation, modelPattern }) {
  if (!identity || !Array.isArray(raw)) return [];
  const isCode = (token) => token.length >= 6 && /[A-Z]/.test(token) && modelPattern.test(token);
  const distinctCodes = (codes) => codes.filter((code, index) => !codes.slice(0, index).some((other) => modelRelation(code, other) !== "DIFFERENT"));
  const words = String(identity).toLowerCase();
  const pages = [];
  for (const entry of raw.slice(0, MAX_PAGES * 2)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).sort().join() !== [...KEYS].sort().join()) continue;
    const source = typeof entry.url === "string" ? safeSourceUrl(entry.url) : null;
    if (!source || source.sourceClass !== "MANUFACTURER" || source.url !== entry.url) continue;
    const maker = source.sourceName.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)[0];
    if (!maker || maker.length < 2 || !new RegExp(`\\b${maker}\\b`).test(words)) continue;
    const pathname = new URL(source.url).pathname;
    if (!isUsStorefront(source.domain, pathname) || NOT_A_PAGE_OF_THE_MODEL.test(pathname)) continue;
    const codes = [...new Set(tokensOf(pathname).filter(isCode))];
    const model = typeof entry.model === "string" ? entry.model.toUpperCase() : "";
    if (!isCode(model) || !codes.includes(model) || distinctCodes(codes).length !== 1) continue;
    if (entry.sourceClass !== "MANUFACTURER" || entry.foundVia !== "SEARCH_RESULT" || entry.pageKind !== pageKindOf(pathname)) continue;
    if (entry.title !== null && typeof entry.title !== "string") continue;
    const title = entry.title === null ? null : safeText(entry.title, MAX_TITLE);
    // A title carrying a claim (a price, a link, an assurance) is withheld by the cleaning: such a page is not relayed at all.
    if (entry.title !== null && title === null) continue;
    if (pages.some((page) => sameAddress(page.url, source.url))) continue;
    pages.push({ url: source.url, domain: source.domain, sourceName: source.sourceName, sourceClass: "MANUFACTURER", model, pageKind: pageKindOf(pathname), title, foundVia: "SEARCH_RESULT" });
  }
  return pages.sort((a, b) => (a.pageKind === b.pageKind ? 0 : a.pageKind === "PRODUCT" ? -1 : 1)).slice(0, MAX_PAGES);
}

module.exports = { projectManufacturerPages };
