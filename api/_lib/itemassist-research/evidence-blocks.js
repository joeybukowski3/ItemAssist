const { REGISTRY } = require("./sources");

/**
 * The two optional candidate blocks of research.2 Release 2, re-validated here exactly as the engine builds them. Each projector returns the block as the engine
 * writes it or null (never a repaired version), so a forged, edited or inflated block is dropped whole:
 *   - `modelObservations`: model codes that recognised sellers' listing titles state, kept apart from price evidence and from verified identity.
 *   - `specComparison`: television attributes compared between the original and the candidate, each with the basis that states it. A listing title is the
 *     seller's wording, not a manufacturer specification; a candidate's attribute is only ever what listing titles state; nothing is inferred from a generation.
 */

const MAX_EXCERPT = 100;
const MAX_ITEMS = 3;
const STATUSES = Object.freeze(["PRICED_LISTING", "EXCLUDED_FROM_PRICE"]);
const EXCLUSIONS = Object.freeze(["PROTECTION_PLAN", "BUNDLE", "NOT_USED_IN_PRICE", "CONFLICTING_CODES"]);
const ATTRIBUTES = Object.freeze(["SCREEN_SIZE", "DISPLAY_CLASS", "RESOLUTION", "REFRESH_RATE", "DOLBY_VISION", "HDMI_2_1"]);
const CORE = Object.freeze(["SCREEN_SIZE", "DISPLAY_CLASS", "RESOLUTION", "REFRESH_RATE"]);
const BASES = Object.freeze(["USER_STATED", "MANUFACTURER_PAGE_TITLE", "LISTING_TITLE"]);
const SHAPES = Object.freeze({
  SCREEN_SIZE: /^\d{2,3}-inch$/, DISPLAY_CLASS: /^(?:OLED|QD-OLED|QLED|Mini-LED|LED)$/, RESOLUTION: /^(?:4K|8K|1080p)$/, REFRESH_RATE: /^(?:60|100|120|144|165|240) Hz$/,
  DOLBY_VISION: /^Dolby Vision$/, HDMI_2_1: /^HDMI 2\.1$/,
});
// A recognised seller is a retailer or a manufacturer's own storefront.
const SELLER_NAMES = new Set(REGISTRY.filter((entry) => ["RETAILER", "MANUFACTURER"].includes(entry[1])).map((entry) => entry[2]));
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value, keys) => isObject(value) && Object.keys(value).sort().join() === [...keys].sort().join();
const sameCode = (a, b) => { const [short, long] = a.length <= b.length ? [a, b] : [b, a]; return short === long || (short.length >= 6 && long.startsWith(short) && long.length - short.length <= 6); };

function projectItem(raw, { modelPattern, looksLikeExactModel, safeText }) {
  if (!exactKeys(raw, ["model", "status", "listings", "retailers", "excerpt", "exclusion", "retrievedAt", "retrievedBasis"])) return null;
  if (typeof raw.model !== "string" || !modelPattern.test(raw.model) || !looksLikeExactModel(raw.model) || !STATUSES.includes(raw.status)) return null;
  if (!Number.isInteger(raw.listings) || raw.listings < 1 || raw.listings > 99) return null;
  if (!Array.isArray(raw.retailers) || raw.retailers.length > MAX_ITEMS || new Set(raw.retailers).size !== raw.retailers.length || !raw.retailers.every((name) => SELLER_NAMES.has(name))
    || raw.retailers.join("|") !== [...raw.retailers].sort().join("|")) return null;
  let excerpt = null;
  if (raw.excerpt !== null) {
    if (typeof raw.excerpt !== "string" || !raw.excerpt || raw.excerpt.length > MAX_EXCERPT || /[\u0000-\u001f\u007f]/.test(raw.excerpt) || raw.excerpt !== raw.excerpt.trim()) return null;
    excerpt = safeText(raw.excerpt, MAX_EXCERPT);
    if (excerpt === null) return null;
  }
  if ((raw.status === "PRICED_LISTING") !== (raw.exclusion === null) || (raw.exclusion !== null && !EXCLUSIONS.includes(raw.exclusion))) return null;
  const dated = typeof raw.retrievedAt === "string" && DAY.test(raw.retrievedAt) && Number.isFinite(Date.parse(raw.retrievedAt));
  if (!["RETRIEVED", "UNKNOWN"].includes(raw.retrievedBasis) || (raw.retrievedBasis === "RETRIEVED") !== dated || (raw.retrievedBasis === "UNKNOWN" && raw.retrievedAt !== null)) return null;
  return { model: raw.model, status: raw.status, listings: raw.listings, retailers: [...raw.retailers], excerpt, exclusion: raw.exclusion, retrievedAt: raw.retrievedAt, retrievedBasis: raw.retrievedBasis };
}

/** @returns {{conflict: boolean, items: object[]}|null} */
function projectModelObservations(raw, helpers) {
  if (!exactKeys(raw, ["conflict", "items"]) || typeof raw.conflict !== "boolean" || !Array.isArray(raw.items) || !raw.items.length || raw.items.length > MAX_ITEMS) return null;
  const items = raw.items.map((item) => projectItem(item, helpers));
  if (items.some((item) => item === null)) return null;
  for (let index = 0; index < items.length; index += 1) if (items.slice(0, index).some((other) => sameCode(other.model, items[index].model))) return null;
  return raw.conflict === (items.length >= 2) ? { conflict: raw.conflict, items } : null;
}

/**
 * True when the observations fit the candidate: a priced model needs a listing-backed status and a price of that model on this candidate, and when the listings state
 * conflicting codes the candidate's name carries no model code.
 */
function observationsFit(block, { name, modelStatus, prices, key, modelRelation, looksLikeExactModel }) {
  if (!block) return false;
  const priced = block.items.filter((item) => item.status === "PRICED_LISTING");
  if (priced.length && !["LISTED_PROVISIONAL", "VERIFIED_LISTING"].includes(modelStatus)) return false;
  const named = String(name || "").toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  if (!priced.every((item) => named.some((token) => sameCode(token, item.model)))) return false;
  if (!priced.every((item) => prices.some((price) => price.candidate === key && ["EXACT", "VARIANT"].includes(modelRelation(price.model, item.model))))) return false;
  return !(block.conflict && looksLikeExactModel(String(name || "")));
}

function projectSide(raw, attribute) {
  if (raw === null) return { ok: true, side: null };
  if (!exactKeys(raw, ["value", "basis", "sources"]) || typeof raw.value !== "string" || !SHAPES[attribute].test(raw.value) || !BASES.includes(raw.basis)) return { ok: false };
  if (!Number.isInteger(raw.sources) || raw.sources < 1 || raw.sources > 99) return { ok: false };
  return { ok: true, side: { value: raw.value, basis: raw.basis, sources: raw.sources } };
}

/** @returns {{rows: object[], compared: string[], notEstablished: string[]}|null} */
function projectSpecComparison(raw) {
  if (!exactKeys(raw, ["rows", "compared", "notEstablished"]) || !Array.isArray(raw.rows) || !Array.isArray(raw.compared) || !Array.isArray(raw.notEstablished)
    || raw.rows.length < CORE.length || raw.rows.length > ATTRIBUTES.length) return null;
  const rows = [];
  let last = -1;
  for (const row of raw.rows) {
    if (!exactKeys(row, ["attribute", "original", "candidate", "result"]) || !ATTRIBUTES.includes(row.attribute) || !["MATCH", "DIFFERENT", "NOT_ESTABLISHED"].includes(row.result)) return null;
    const order = ATTRIBUTES.indexOf(row.attribute);
    if (order <= last) return null;
    last = order;
    const before = projectSide(row.original, row.attribute);
    const after = projectSide(row.candidate, row.attribute);
    if (!before.ok || !after.ok || (after.side && after.side.basis !== "LISTING_TITLE")) return null;
    const result = !before.side || !after.side ? "NOT_ESTABLISHED" : before.side.value === after.side.value ? "MATCH" : "DIFFERENT";
    if (row.result !== result || (!CORE.includes(row.attribute) && !before.side && !after.side)) return null;
    rows.push({ attribute: row.attribute, original: before.side, candidate: after.side, result });
  }
  if (!CORE.every((attribute) => rows.some((row) => row.attribute === attribute))) return null;
  const compared = rows.filter((row) => row.result !== "NOT_ESTABLISHED").map((row) => row.attribute);
  const notEstablished = rows.filter((row) => row.result === "NOT_ESTABLISHED").map((row) => row.attribute);
  return raw.compared.join() === compared.join() && raw.notEstablished.join() === notEstablished.join() ? { rows, compared, notEstablished } : null;
}

/** Retrieval dates are real, recent and no later than the response's reference date; a page-title basis needs the original's page. */
function blocksFitReferences({ observations, comparison, referenceDate, hasPages }) {
  const floor = Date.parse(referenceDate) - 31 * 86400000;
  if (comparison && comparison.rows.some((row) => row.original && row.original.basis === "MANUFACTURER_PAGE_TITLE") && !hasPages) return false;
  return !observations || observations.items.every((item) => item.retrievedAt === null || (item.retrievedAt <= referenceDate && Date.parse(item.retrievedAt) >= floor));
}

module.exports = { projectModelObservations, projectSpecComparison, observationsFit, blocksFitReferences, SPEC_ATTRIBUTES: ATTRIBUTES };
