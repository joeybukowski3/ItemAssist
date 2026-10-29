/*
 * ItemAssist Research session logic for the workspace: how a typed message is understood in an ongoing conversation, the one-line
 * research query it becomes, answers that need no AI call, and the fixed customer wording. Pure and dependency-free (apart from
 * rf-shared.js), loaded by <script> in the browser (window.RFResearch) and required directly by Node tests.
 *
 * It never calls the network and holds no product knowledge: every product fact comes from the proxy's research response. State is
 * immutable (each step returns a new session) and lives in memory only; the single thing stored in the browser is an anonymous
 * random visitor ID, used by the proxy to meter the daily allowance.
 */
(function (root) {
  "use strict";

  const RF = typeof module === "object" && module.exports ? require("./rf-shared.js") : root.RFShared;

  const MAX_QUERY_CHARS = 160;
  const MAX_REFINEMENTS = 6;
  const SHORT_REPLY_CHARS = 40;
  const CLARIFY_REPLY_CHARS = 80;
  const VISITOR_KEY = "itemassist_visitor_v1";
  const VISITOR_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

  const NEW_PATTERN = /^(?:new(?:\s+(?:research|item|search))?|start\s+(?:over|again|fresh)|different\s+item|another\s+item|reset|cancel|never\s*mind)\b[\s:,.-]*/i;
  const QUESTION_PATTERN = /\?\s*$|^(?:why|how|what|which|who|can|could|does|do|is|are|should|will|tell\s+me|explain)\b/i;
  // A request about the current results ("find a cheaper alternative"): answered from them, never sent as research with the words appended.
  const REQUEST_PATTERN = /^(?:find|show|give|list|suggest|recommend|look\s+for|compare|is\s+there|are\s+there|any\s+(?:other|cheaper|better|similar))\b/i;
  // A part or add-on rather than a product of its own: it is never merged into the current item's query (see classify).
  const ACCESSORY_PATTERN = /\b(?:soundbar|sound\s+bar|subwoofer|remote(?:\s+control)?|stand|wall\s+mount|mount|bracket|cable|cord|charger|adapter|controller|gamepad|filter|shelf|shelves|drawer|handle|gasket|bulb|lid|rack|dock|battery|headset|case|cover)\b/i;
  // What a detail about the current item looks like: a size with its unit, a bare number, a year, or a plain descriptor. Anything short that
  // is none of these is not assumed to be a detail: an unfamiliar name ("roomba 675") is asked about, not appended.
  const DETAIL_NUMBER = /\b\d+(?:\.\d+)?\s*(?:"|-?\s?(?:inch|inches|in|cu|ft|k|hz|gb|tb|lb|lbs|w|v|l|cm|mm))(?![a-z])|^(?:the\s+)?\d{1,3}(?:\s|$)|\b(?:19|20)\d{2}\b/i;
  const DETAIL_WORDS = /\b(?:inch|inches|size|sized|color|colour|finish|stainless|steel|black|white|silver|gray|grey|slate|bisque|red|blue|green|gold|matte|glossy|model|version|series|year|older|newer|new|old|used|wall|mounted|counter|depth|french|door|side|top|bottom|freezer|smart|portable|built|front|load|gas|electric|frame|panel|curved|flat|oled|qled|led|lcd|plasma|hdr|dolby|gaming)\b/i;
  // A reply to the open clarifying question usually starts like an answer.
  const ANSWER_LEAD = /^(?:yes|yeah|yep|no|nope|not\s+sure|i\s+(?:don'?t|do\s+not)\s+know|idk|about|around|roughly|approximately|probably|maybe|it(?:'s|\s+is|\s+was)|its|mine|i\s+(?:have|think|believe|measured|bought)|in|on|at)\b/i;
  // Spec and feature tokens are not model codes ("4k", "120hz", "hdr10"); a model code mixes letters and digits ("c3", "qn55q80c").
  const SPEC_TOKEN = /^\d+(?:k|p|x|hz|gb|tb|mb|w|v|l|mm|cm|in|ft|lb|lbs|cu|ms|nits)$/;
  const FEATURE_TOKEN = /^(?:hdr|hdmi|wifi|usb|gen|dolby|atmos|bt|cat)\d*\+?$/;

  /* ---------- Wording ---------- */

  // The banner above the report: what kind of result this is, stated once and plainly.
  const SUMMARY_TITLE = "AI Research Summary";
  const DEMO_LABEL = "Demo research data";
  const SUMMARY_NOTE = "Specifications and replacement suggestions are preliminary and not independently verified. Availability and pricing are not checked.";
  const FINEPRINT_V2 = "ItemAssist Research provides preliminary AI-assisted product and pricing guidance, not a professional appraisal or verified replacement-cost determination. Specifications and retailer prices may be incomplete or estimated. Confirm essential features, availability and current prices before relying on a replacement recommendation.";
  const GREETING ="Describe the item you're replacing: a brand and model number, or a short description. I'll identify it, outline what a replacement should match, and suggest candidates to explore.";
  const PLACEHOLDER = "Describe the item or answer my question...";
  const FINEPRINT = "ItemAssist Research gives AI estimates from general product knowledge. Specifications, availability and pricing are not verified; confirm them before buying.";
  const ASK_WHICH = "Is that more detail about this item, or a different item?";
  const ASK_ACCESSORY = "That sounds like an accessory or a separate item. Research it on its own?";
  const STAY_ON_ITEM = "Okay. I'll stay with your current item.";
  const FALLBACK_HELP = "I can explain what I found, or refine it if you add detail such as size, color or finish. Type \"new research\" to start over.";
  const TOO_LONG = "That's a bit long for me to research as one description. Please keep it under 160 characters, or type \"new research\" to start over.";
  const STARTING_FRESH = "Starting fresh. What item should I research?";

  const ERROR_MESSAGES = Object.freeze({
    API_DISABLED: "ItemAssist Research isn't available right now.",
    INVALID_REQUEST: "I couldn't use that description. Try a brand and model number, or a short description under 160 characters.",
    RATE_LIMITED: "You're sending requests quickly. Please wait a few minutes and try again.",
    QUOTA_EXCEEDED: "You've used today's free ItemAssist Research requests. They reset tomorrow.",
    SERVICE_UNAVAILABLE: "ItemAssist Research is temporarily unavailable. Please try again later.",
    CAPACITY_REACHED: "ItemAssist Research has reached its daily capacity. Please try again tomorrow.",
    ENGINE_TIMEOUT: "That took too long to finish. Please try again.",
    ENGINE_ERROR: "I couldn't complete that research. Please try again later.",
    NETWORK_ERROR: "I couldn't reach ItemAssist Research. Check your connection and try again."
  });
  const OFFER_CLASSIC = Object.freeze(["API_DISABLED", "SERVICE_UNAVAILABLE", "ENGINE_TIMEOUT", "ENGINE_ERROR", "NETWORK_ERROR", "CAPACITY_REACHED"]);

  function errorMessage(code) {
    return Object.prototype.hasOwnProperty.call(ERROR_MESSAGES, code) ? ERROR_MESSAGES[code] : ERROR_MESSAGES.ENGINE_ERROR;
  }

  /** True when the classic lookup is a sensible alternative to offer after this error (never after a quota or rate limit). */
  function offersClassic(code) {
    return OFFER_CLASSIC.indexOf(code) !== -1;
  }

  /* ---------- research.2: prices, valuation and evidence wording ---------- */

  // Fixed wording for every price-related code. Nothing here is taken from the response except codes, enumerated values and numbers, so a
  // response can never put its own words (a claim, a link, a price) into these labels. An estimate is never worded as verified.
  const SUMMARY_NOTE_V2 = "Specifications and replacement suggestions are preliminary. A price is called confirmed only when it comes from the cited source on the date shown; every other figure is an estimate or an unconfirmed listing.";
  const PRICE_KIND_LABELS = Object.freeze({
    MSRP: "Original list price (MSRP)", HISTORICAL_RETAIL: "Past retail price", ORIGINAL_LISTING: "Original model listing", CURRENT_RETAIL_NEW: "Current new-retail price",
    SECONDARY_REPORT: "Used or marketplace report", AI_ESTIMATE: "AI estimate"
  });
  const VERIFICATION_LABELS = Object.freeze({
    VERIFIED_PAGE: "Shown on the cited source page", SEARCH_LISTING: "Seen in a search listing, not confirmed on the page",
    SEARCH_SNIPPET: "Seen in a search snippet, not confirmed", NONE: "No source: estimate"
  });
  const DATE_LABELS = Object.freeze({ OBSERVED: "Observed", PUBLISHED: "Published", UNKNOWN: "Date not stated" });
  const METHOD_LABELS = Object.freeze({
    VERIFIED_MULTI: "Confirmed current prices", VERIFIED_SINGLE: "One confirmed current price", MIXED_VERIFIED_AND_LISTINGS: "Confirmed prices and unconfirmed listings",
    PROVISIONAL_LISTINGS: "Unconfirmed retailer listings", HISTORICAL_TIER_ESTIMATE: "Estimate from the original's price", AI_ESTIMATE_ONLY: "AI estimate only",
    INSUFFICIENT: "Not enough evidence"
  });
  const TIER_LABELS = Object.freeze({ VALUE: "Value", STANDARD: "Standard", PREMIUM: "Premium", UPPER_PREMIUM: "Upper premium", LUXURY: "Luxury", UNKNOWN: "Not determined" });
  const TIER_BASIS_LABELS = Object.freeze({ MSRP_EVIDENCE: "Based on the original's reported price", AI_ESTIMATE: "AI estimate of the market tier", UNKNOWN: "Not determined" });
  const IMPORTANCE_LABELS = Object.freeze({ ESSENTIAL: "Essential", IMPORTANT: "Important", MINOR: "Minor" });
  const ORIGIN_LABELS = Object.freeze({ CATEGORY_RULE: "Standard for this type of item", AI_ESTIMATE: "Added by the AI estimate" });
  const COMPARISON_LABELS = Object.freeze({ MEETS: "Meets", EXCEEDS: "Exceeds", SHORTFALL: "Falls short", UNKNOWN: "Not known" });
  const BASIS_LABELS = Object.freeze({ CONFIRMED: "Confirmed by a cited source", AI_ESTIMATE: "AI estimate" });
  const MODEL_STATUS_LABELS = Object.freeze({
    VERIFIED_LISTING: "Model named on a cited seller or maker page", LISTED_PROVISIONAL: "Model named in a cited search listing, not confirmed",
    FAMILY_LEVEL: "Product family, exact model not confirmed", UNVERIFIED_MODEL: "Exact model identity has not been independently confirmed"
  });
  const SOURCE_CLASS_LABELS = Object.freeze({ MANUFACTURER: "Manufacturer", RETAILER: "Retailer", REVIEW: "Review site", TECH_DATABASE: "Specification database", MARKETPLACE: "Marketplace" });
  const MODEL_RELATION_LABELS = Object.freeze({ EXACT: "Same model code", VARIANT: "Variant of the model code", DIFFERENT: "Different model code", UNKNOWN: "Model match not shown in the evidence" });
  const EXCLUSION_LABELS = Object.freeze({
    CONFIRMED_ESSENTIAL_SHORTFALL: "Not in the range: it falls short of an essential requirement (confirmed by a cited source)",
    SUSPECTED_ESSENTIAL_SHORTFALL: "Not in the range: it appears to fall short of an essential requirement (an estimate)",
    NO_CURRENT_PRICE: "Not in the range: no current retail price is included in this research"
  });
  // What a price did in the valuation: it set the range, it is context only, or it was left out (with the reason shown beside it).
  const PRICE_ROLE_LABELS = Object.freeze({ USED_IN_RANGE: "Sets the range", CONTEXT_ONLY: "Context only", EXCLUDED: "Excluded from the range" });
  const PRICE_ROLE_REASONS = Object.freeze({
    ORIGINAL_CONTEXT: "Context for the original's market tier. It never sets the replacement range.",
    DATED_PRICE: "A dated price, not a current one. It does not set the range.",
    SECONDARY_REPORT: "A used or marketplace report. It does not set the range.",
    AI_ESTIMATE: "An AI estimate with no source. It sets the range only when nothing better is available.",
    ORIGINAL_ESTIMATE: "An AI estimate of the original's price. No source supports it, and it never sets the replacement range.",
    NOT_COMPARABLE: "Not used for the range.",
    ORIGINAL_LISTING: "A price seen for the original model on a seller's page, with no reliable date. It may be a sale, clearance or discontinued price. It is not a list price, and it never sets the replacement range.",
    OTHER_FAMILY: "A current price for a different candidate family. It is listed separately and does not set the headline range.",
    SIZE_NOT_CONFIRMED: "A retail example whose size is not confirmed against the original. It does not confirm a match and does not set the range.",
    CURRENT_COMPARABLE: "A current price for a candidate with no essential requirement known to fall short. It is not confirmed as an exact match.",
    ESTIMATE_ANCHOR: "The estimate band scales this price. No current retail price is included in this research.",
    ESTIMATE_RANGE: "An AI estimate. No source supports it."
  });
  const REJECTION_REASON_LABELS = Object.freeze({
    AMOUNT_INVALID: "an amount that was not a valid price", CURRENCY_UNSUPPORTED: "a price that was not in US dollars", DATE_INVALID: "a date that was not a real date",
    DATE_IN_FUTURE: "a date in the future", DATE_REQUIRED: "a price with no date", ESTIMATE_CITES_SOURCE: "an estimate that cited a source",
    KIND_SOURCE_MISMATCH: "a price from a kind of source that cannot support it", MODEL_UNVERIFIED: "a model number with no evidence about that model",
    SHAPE_INVALID: "an entry that was malformed", SOURCE_FABRICATED: "a citation whose link and stated source did not match", SOURCE_INVALID: "a link that was not a usable web address",
    SOURCE_NOT_ALLOWED: "a source that is not on the accepted list", STALE_CURRENT_PRICE: "a price too old to be called current", SUBJECT_INVALID: "an entry about the wrong item",
    VERIFICATION_DOWNGRADED: "a price confirmed less strongly than claimed", WRONG_PRODUCT: "a price for a different model", COMPARISON_NOT_CONFIRMED: "a comparison with no source behind it",
    ESSENTIAL_FROM_AI_DOWNGRADED: "an essential requirement added by the AI estimate", IMPORTANCE_FIXED_BY_CODE: "a requirement ranked differently than the standard for this item",
    MODEL_STATUS_DOWNGRADED: "a model status stronger than the evidence", TIER_BASIS_DOWNGRADED: "a market tier with no price behind it"
  });
  const REJECTION_ACTION_LABELS = Object.freeze({ REJECTED: "Set aside", DOWNGRADED: "Downgraded" });
  const CANDIDATE_LABELS = Object.freeze({ SUCCESSOR: "The successor candidate", ALT_1: "Alternative 1", ALT_2: "Alternative 2" });
  const DEMO_PRICE_NOTE = "Demo data: the figures and sources in this panel are illustrative, not real prices.";
  const COMPATIBILITY_TEXT = "Compatibility not fully established. Confirm the original door configuration and fit before relying on this range.";

  const percent = (ratio) => Math.round(ratio * 100) + "%";
  const plural = (count, one, many) => count + " " + (count === 1 ? one : many);
  const NOTE_TEXT = Object.freeze({
    BASED_ON_VERIFIED: (note) => "Based on " + plural(note.count, "current price", "current prices") + " shown on cited seller pages.",
    BASED_ON_LISTINGS: (note) => "Built from " + plural(note.count, "retailer listing", "retailer listings") + ".",
    ONE_COMPARABLE: () => "One confirmed price anchors one model. It is not a range.",
    LISTINGS_NOT_CONFIRMED: () => "Listing prices can differ from the seller's page.",
    TIER_ESTIMATE_BAND: (note) => "No current retail price is included in this research. The band scales the original's reported price to " + percent(note.low) + " to " + percent(note.high) + ", a broad rule for this type of item.",
    AI_ESTIMATE_ONLY: () => "No source supports this range. It is an AI estimate.",
    INSUFFICIENT: () => "There is not enough evidence to estimate a value yet.",
    // A past retail price is not a list price: the sentence names the kind of price the valuation actually points at.
    MSRP_CONTEXT_ONLY: (note, context) => "The original's " + (context && context.referenceKind === "HISTORICAL_RETAIL" ? "past retail price" : "list price") + " is context only. It does not set the replacement range.",
    OTHER_FAMILIES_SEPARATE: (note) => (note.count === 1 ? "Prices for another candidate family are" : "Prices for " + note.count + " other candidate families are") + " listed separately. They do not set this range.",
    COMPATIBILITY_NOT_ESTABLISHED: () => COMPATIBILITY_TEXT,
    CURRENT_BELOW_ORIGINAL: (note) => "Current prices are about " + percent(note.ratio) + " of the original's list price.",
    ORIGINAL_DATE_UNKNOWN: () => "The date of the original's price is not stated, so a wider band is used.",
    TIER_UNKNOWN_WIDENED: () => "The market tier is not known, so the band is wider.",
    EXCLUDED_CONFIRMED_SHORTFALL: (note) => CANDIDATE_LABELS[note.candidate] + " is left out: it falls short of an essential requirement.",
    EXCLUDED_SUSPECTED_SHORTFALL: (note) => CANDIDATE_LABELS[note.candidate] + " is left out: it appears to fall short of an essential requirement (an estimate).",
    EXCLUDED_NO_CURRENT_PRICE: (note) => CANDIDATE_LABELS[note.candidate] + " is not in the range: no current retail price for it is included in this research.",
    STALE_PRICES_NOT_CURRENT: (note) => plural(note.count, "older price is", "older prices are") + " included as dated. Older prices are never shown as current.",
    NOT_AN_APPRAISAL: () => "Estimates and listing prices can differ from what a seller charges."
  });

  /**
   * The caution shown directly under the headline value when the range rests on listings priced while a material fact about the original (its
   * door configuration) is unresolved, or null. It comes from the valuation note the engine derives from its own eligibility state.
   */
  function compatibilityLine(valuation) {
    return valuation && Array.isArray(valuation.notes) && valuation.notes.some(function (note) { return note && note.code === "COMPATIBILITY_NOT_ESTABLISHED"; }) ? COMPATIBILITY_TEXT : null;
  }

  /** The fixed sentence for a valuation note, or null for a code this page does not know. `context` (optional) names the kind of price the valuation points at. */
  function noteText(note, context) {
    return note && Object.prototype.hasOwnProperty.call(NOTE_TEXT, note.code) ? NOTE_TEXT[note.code](note, context) : null;
  }

  function label(table, key, fallback) {
    return typeof key === "string" && Object.prototype.hasOwnProperty.call(table, key) ? table[key] : fallback;
  }

  /** "$2,399" for a whole amount, "$2,399.50" otherwise. Formatting only; the amount is never adjusted. */
  function formatMoney(amount) {
    if (typeof amount !== "number" || !Number.isFinite(amount)) return null;
    const whole = Math.round(amount) === amount;
    try {
      return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 }).format(amount);
    } catch (error) {
      return "$" + amount.toFixed(whole ? 0 : 2);
    }
  }

  /** "$1,199 to $1,399", or one figure when low equals high; null without a valid range. */
  function formatRange(range) {
    if (!range || typeof range !== "object") return null;
    const low = formatMoney(range.low);
    const high = formatMoney(range.high);
    if (!low || !high) return null;
    return range.low === range.high ? low : low + " to " + high;
  }

  /** "Oct 21, 2026" from a YYYY-MM-DD date, in UTC so it reads the same everywhere; null for anything else. */
  function formatDay(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const moment = new Date(value + "T00:00:00Z");
    // Round-trip so a lenient parse of an impossible date ("2026-02-30") is refused rather than shown as another day.
    if (!Number.isFinite(moment.getTime()) || moment.toISOString().slice(0, 10) !== value) return null;
    try {
      return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(moment);
    } catch (error) {
      return null;
    }
  }

  const isV2 = (data) => Boolean(data) && data.contractVersion === "research.2";

  // Listing prices this close (highest within 2% of the lowest) are one price seen at several sellers.
  const NEAR_IDENTICAL_RATIO = 1.02;

  /** True when the valuation rests on listings that are one price, not a spread: a single listing, or several within NEAR_IDENTICAL_RATIO. */
  function isListingAnchor(valuation) {
    if (!valuation || valuation.method !== "PROVISIONAL_LISTINGS" || !valuation.range || !Array.isArray(valuation.comparables) || !valuation.comparables.length) return false;
    return valuation.comparables.length === 1 || valuation.range.high <= valuation.range.low * NEAR_IDENTICAL_RATIO;
  }

  /**
   * One honest sentence for the valuation. The words come from the method alone: a confirmed price is called confirmed, a listing is
   * called unconfirmed, a band built from the original's price or from the AI is called an estimate.
   */
  function valuationLine(valuation) {
    if (!valuation) return null;
    const range = formatRange(valuation.range);
    const asOf = formatDay(valuation.asOf);
    switch (valuation.method) {
      case "VERIFIED_MULTI":
        return range ? "Current new-retail prices shown on cited seller pages: " + range + (asOf ? ", as of " + asOf : "") + "." : null;
      case "VERIFIED_SINGLE":
        return range ? "One confirmed current new-retail price: " + range + (asOf ? ", as of " + asOf : "") + "." : null;
      case "MIXED_VERIFIED_AND_LISTINGS":
        return range ? "Current retail prices point to " + range + (asOf ? ", as of " + asOf : "") + ". Some of those are listings not confirmed on the product page." : null;
      case "PROVISIONAL_LISTINGS":
        // Listings that agree within a couple of percent are one price seen at several sellers, not a market range.
        if (range && isListingAnchor(valuation) && valuation.comparables.length > 1) {
          const count = valuation.comparables.length;
          return (count === 2 ? "Two" : String(count)) + " retailer listings agree at about " + formatMoney(valuation.range.low) + (asOf ? ", as of " + asOf : "") + ". They are listing prices, not confirmed on the product page, and not a value range.";
        }
        // One qualifying listing is an anchor for one price, not a range and not a conclusion about value.
        if (range && (valuation.comparables || []).length === 1) return "One retailer listing shows " + range + (asOf ? ", as of " + asOf : "") + ". It is a single listing price, not confirmed on the product page, and not a value range.";
        return range ? "Retailer listings suggest roughly " + range + (asOf ? ", as of " + asOf : "") + ". These are listing prices, not confirmed on the product page." : null;
      case "HISTORICAL_TIER_ESTIMATE":
        return range ? "No current retail price is included in this research. Based on the original's reported price, a rough estimate is " + range + ". It is an estimate, not a price for a replacement." : null;
      case "AI_ESTIMATE_ONLY":
        return range ? "A rough AI estimate is " + range + ". No source supports it, and no current listing was eligible to check it against, so it is not a market-value range." : null;
      default:
        return "There isn't enough evidence to estimate a value yet.";
    }
  }

  /**
   * What a price did in the valuation, derived only from the valuation's own comparables, exclusions and reference, so the price list and the
   * range always reconcile: USED_IN_RANGE (it sets the range, or anchors an estimate band), EXCLUDED (its candidate was left out, with the
   * exclusion reason), or CONTEXT_ONLY. `note` is a key of PRICE_ROLE_REASONS; `exclusion` is an exclusion reason code.
   */
  function priceRole(pricing, price) {
    const value = pricing && pricing.valuation;
    if (!value || !price) return null;
    // A listing that states no screen size is shown as an example, whatever else is true of its candidate.
    if (price.sizeConfirmed === false) return { role: "CONTEXT_ONLY", note: "SIZE_NOT_CONFIRMED", exclusion: null };
    if ((value.comparables || []).some(function (row) { return row.priceId === price.id; })) {
      return { role: "USED_IN_RANGE", note: price.kind === "AI_ESTIMATE" ? "ESTIMATE_RANGE" : "CURRENT_COMPARABLE", exclusion: null };
    }
    if (value.method === "HISTORICAL_TIER_ESTIMATE" && value.reference && value.reference.priceId === price.id) {
      return { role: "USED_IN_RANGE", note: "ESTIMATE_ANCHOR", exclusion: null };
    }
    const left = price.candidate ? (value.excluded || []).filter(function (row) { return row.candidate === price.candidate; })[0] : null;
    if (left) return { role: "EXCLUDED", note: null, exclusion: left.reason };
    let note = "NOT_COMPARABLE";
    // A current price for a candidate family none of the range's comparables belong to: listed apart from the headline, not discarded.
    const otherFamily = price.kind === "CURRENT_RETAIL_NEW" && price.candidate && (value.comparables || []).length > 0
      && !(value.comparables || []).some(function (row) { return row.candidate === price.candidate; });
    if (otherFamily) note = "OTHER_FAMILY";
    else if (price.kind === "AI_ESTIMATE") note = price.subject === "ORIGINAL" ? "ORIGINAL_ESTIMATE" : "AI_ESTIMATE";
    else if (price.kind === "ORIGINAL_LISTING") note = "ORIGINAL_LISTING";
    else if (price.subject === "ORIGINAL") note = "ORIGINAL_CONTEXT";
    else if (price.kind === "HISTORICAL_RETAIL") note = "DATED_PRICE";
    else if (price.kind === "SECONDARY_REPORT") note = "SECONDARY_REPORT";
    return { role: "CONTEXT_ONLY", note: note, exclusion: null };
  }

  /** The prices in each role, in id order, for the Pricing tab's three groups. */
  function pricesByRole(pricing) {
    const groups = { USED_IN_RANGE: [], CONTEXT_ONLY: [], EXCLUDED: [] };
    (pricing.prices || []).slice().sort(function (a, b) { return a.id.localeCompare(b.id, undefined, { numeric: true }); }).forEach(function (price) {
      groups[priceRole(pricing, price).role].push(price);
    });
    return groups;
  }

  /** The count of candidates left out of the value range for an essential shortfall. */
  function shortfallCount(valuation) {
    return valuation ? (valuation.excluded || []).filter(function (row) { return /ESSENTIAL_SHORTFALL$/.test(row.reason); }).length : 0;
  }

  /**
   * The original's own prices for display: dated list and past retail prices (list price first, then by date), and an AI estimate kept apart.
   * Conflicting sourced prices are all kept; the page shows each with its source and date.
   */
  function originalPrices(pricing) {
    const own = ((pricing && pricing.prices) || []).filter(function (price) { return price.subject === "ORIGINAL"; });
    const sourced = own.filter(function (price) { return price.kind === "MSRP" || price.kind === "HISTORICAL_RETAIL"; }).sort(function (a, b) {
      return (a.kind === b.kind ? 0 : a.kind === "MSRP" ? -1 : 1) || String(a.asOf || "").localeCompare(String(b.asOf || "")) || a.id.localeCompare(b.id, undefined, { numeric: true });
    });
    // Listings of the original model (undated, current or clearance) are context, kept apart from its list and dated past prices.
    const listings = own.filter(function (price) { return price.kind === "ORIGINAL_LISTING"; }).sort(function (a, b) { return a.amount.low - b.amount.low; });
    return { sourced: sourced, listings: listings, estimate: own.filter(function (price) { return price.kind === "AI_ESTIMATE"; })[0] || null };
  }

  /** One short sentence about the original's price history when it is more than a single sourced price, else null. */
  function historySummary(pricing) {
    const history = originalPrices(pricing);
    if (history.sourced.length > 1) {
      const low = Math.min.apply(null, history.sourced.map(function (price) { return price.amount.low; }));
      const high = Math.max.apply(null, history.sourced.map(function (price) { return price.amount.high; }));
      return low === high ? "Dated sources agree on " + formatMoney(low) + " for the original when new."
        : "Dated sources put the original at " + formatRange({ low: low, high: high }) + " when new. They differ, so each is shown.";
    }
    if (!history.sourced.length && history.estimate) return "No dated price is included. An AI estimate puts the original at " + formatRange(history.estimate.amount) + " when new.";
    return null;
  }

  /** The original's reference price (list or past retail) the valuation points at, or null. */
  function referencePrice(pricing) {
    if (!pricing || !pricing.valuation || !pricing.valuation.reference) return null;
    return (pricing.prices || []).filter(function (price) { return price.id === pricing.valuation.reference.priceId; })[0] || null;
  }

  /* ---------- Session ---------- */

  function initialSession() {
    return Object.freeze({ base: null, refinements: Object.freeze([]), pending: Object.freeze([]), last: null });
  }

  const clean = (text) => RF.clean(typeof text === "string" ? text : "");

  /** Model-code-like tokens: letters and digits mixed (c3, s90d, qn55q80c), excluding sizes and feature names. */
  function modelCodes(text) {
    return clean(text).toLowerCase().split(/[^a-z0-9]+/).filter(function (token) {
      return token.length >= 2 && /[a-z]/.test(token) && /\d/.test(token) && !SPEC_TOKEN.test(token) && !FEATURE_TOKEN.test(token);
    });
  }

  function sameCode(a, b) {
    return a === b || (Math.min(a.length, b.length) >= 4 && (a.indexOf(b) !== -1 || b.indexOf(a) !== -1));
  }

  // Deliberately small: well-known brands and plain product-type words are enough to notice that a message is about something else.
  // A message that names neither is never "a different product" by this check.
  const BRANDS = ["lg", "samsung", "sony", "vizio", "tcl", "hisense", "panasonic", "toshiba", "whirlpool", "ge", "frigidaire", "maytag", "bosch", "kenmore", "electrolux",
    "kitchenaid", "haier", "apple", "dell", "hp", "lenovo", "asus", "acer", "rheem", "trane", "carrier", "goodman", "lennox"];
  const TYPES = [
    ["tv", /\b(?:tv|tvs|television|televisions|oled|qled)\b/], ["refrigerator", /\b(?:refrigerator|refrigerators|fridge|fridges|freezer)\b/],
    ["washer", /\b(?:washer|washers|washing machine)\b/], ["dryer", /\bdryers?\b/], ["dishwasher", /\bdishwashers?\b/],
    ["range", /\b(?:range|oven|stove|cooktop)\b/], ["microwave", /\bmicrowaves?\b/], ["computer", /\b(?:laptop|computer|pc|desktop)\b/],
    ["phone", /\b(?:phone|smartphone|iphone)\b/], ["hvac", /\b(?:furnace|hvac|air conditioner|heat pump)\b/], ["water heater", /\bwater heaters?\b/],
    ["game console", /\b(?:playstation|ps[1-5]|xbox|nintendo|wii|gameboy|game\s+boy|game\s+console|console)\b/], ["camera", /\b(?:camera|camcorder|gopro)\b/],
    ["headphones", /\b(?:headphones?|earbuds?|airpods)\b/], ["speaker", /\bspeakers?\b/], ["tablet", /\b(?:tablet|ipad)\b/], ["printer", /\bprinters?\b/],
    ["watch", /\b(?:smartwatch|watch)\b/], ["vacuum", /\b(?:vacuum|roomba)\b/], ["monitor", /\bmonitors?\b/], ["grill", /\bgrills?\b/],
    ["small appliance", /\b(?:blender|toaster|air\s+fryer|coffee\s+maker|mixer)\b/], ["furniture", /\b(?:mattress|sofa|couch|recliner)\b/]
  ];

  const brandsIn = (text) => clean(text).toLowerCase().split(/[^a-z0-9]+/).filter(function (word) { return BRANDS.indexOf(word) !== -1; });
  const typesIn = (text) => TYPES.filter(function (entry) { return entry[1].test(clean(text).toLowerCase()); }).map(function (entry) { return entry[0]; });
  const disjoint = (a, b) => a.length > 0 && b.length > 0 && !a.some(function (item) { return b.indexOf(item) !== -1; });
  const ACCESSORY_MAX_WORDS = 8;
  const wordsIn = (text) => clean(text).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  /** True when the message repeats a word of the current item's own description ("LG", "OLED"): it is about that item. */
  const sharesWord = (session, text) => { const own = wordsIn(session.base); return wordsIn(text).some(function (word) { return word.length >= 2 && own.indexOf(word) !== -1; }); };
  // A bare model code for an item described without one ("C3" after "old LG OLED tv") completes that item's description.
  const bareCodeForCodelessItem = (session, text) => { const codes = modelCodes(text); return codes.length > 0 && modelCodes(session.base).length === 0 && wordsIn(text).every(function (word) { return codes.indexOf(word) !== -1; }); };
  const looksLikeDetail = (session, text) => DETAIL_NUMBER.test(text) || DETAIL_WORDS.test(text) || sharesWord(session, text) || bareCodeForCodelessItem(session, text);
  /** A model code that matches none of the current item's codes (an item described without a code has nothing to contradict). */
  function namesAnotherModel(session, codes) {
    const baseCodes = modelCodes(session.base);
    return codes.length > 0 && baseCodes.length > 0 && !codes.some(function (code) { return baseCodes.some(function (base) { return sameCode(code, base); }); });
  }

  /**
   * What a typed message is, decided without any AI call.
   *   empty    nothing to do
   *   reset    "new research" with no item: start fresh and ask for one
   *   new      a new item (text is the description, with any "new research:" prefix removed)
   *   refine   more detail on the current item
   *   question a question about the current results, answered locally from them
   *   ask      ambiguous: the page asks which of refine / new was meant (`reason: "accessory"` for a part or add-on)
   * `turnIntent` names the same decision as NEW_PRODUCT, FOLLOW_UP (refine or question), AMBIGUOUS, RESET or EMPTY.
   */
  function decide(session, input) {
    const text = clean(input);
    if (!text) return { kind: "empty" };
    const marker = NEW_PATTERN.exec(text);
    if (marker) {
      const rest = text.slice(marker[0].length).trim();
      return rest ? { kind: "new", text: rest } : { kind: "reset" };
    }
    if (!session.base) return { kind: "new", text: text };
    const codes = modelCodes(text);
    const asksAboutResults = QUESTION_PATTERN.test(text) || REQUEST_PATTERN.test(text);
    // Explicitly naming a different product wins over any open question, and over a question's phrasing:
    //  - a model code that matches none of the current item's codes (a code when the item had none is just a detail), or
    //  - a different kind of product (a refrigerator or a game console when researching a TV).
    if (namesAnotherModel(session, codes)) return { kind: "new", text: text };
    // A part or add-on ("soundbar", "wall mount for it") is not a detail of the item and not clearly a product of its own: ask, never merge.
    if (!asksAboutResults && !codes.length && ACCESSORY_PATTERN.test(text) && text.split(/\s+/).length <= ACCESSORY_MAX_WORDS && !sharesWord(session, text)) {
      return { kind: "ask", text: text, reason: "accessory" };
    }
    if (disjoint(typesIn(text), typesIn(session.base))) return { kind: "new", text: text };
    // Only a different brand: it could be a different item or a preference ("I'd like a Samsung"), so the page asks instead of guessing.
    // The exception is a question about a candidate the results already name ("what's different about the Sony?").
    if (disjoint(brandsIn(text), brandsIn(session.base))) {
      const candidates = session.last ? candidateOf(session.last).map(function (item) { return item.name; }).join(" ") : "";
      const aboutACandidate = QUESTION_PATTERN.test(text) && !disjoint(brandsIn(text), brandsIn(candidates));
      if (!aboutACandidate) return { kind: "ask", text: text };
    }
    if (session.last && asksAboutResults) return { kind: "question", text: text };
    // Detail on the current item is appended to its query, so only a message that looks like detail (or answers the open question) is
    // taken as one. An unfamiliar short name is asked about: guessing "detail" would put two products in one query.
    const detail = looksLikeDetail(session, text);
    if (session.pending.length && text.length <= CLARIFY_REPLY_CHARS && (detail || ANSWER_LEAD.test(text))) return { kind: "refine", text: text };
    if (!session.pending.length && text.length <= SHORT_REPLY_CHARS && detail) return { kind: "refine", text: text };
    return { kind: "ask", text: text };
  }

  // How a verdict reads as a turn: a different product starts a new research context, a follow-up continues the current one,
  // anything unclear is asked about.
  const INTENTS = Object.freeze({ empty: "EMPTY", reset: "RESET", new: "NEW_PRODUCT", refine: "FOLLOW_UP", question: "FOLLOW_UP", ask: "AMBIGUOUS" });

  const classify = decide;
  const turnIntent = (session, input) => INTENTS[decide(session, input).kind];

  /**
   * The mode a message is actually sent in. "More detail on this item" (chosen after a question from the page) never merges a message that names
   * another model or another kind of product into the current item's query: that is a new item.
   */
  function resolveMode(session, mode, input) {
    if (mode !== "refine" || !session.base) return mode;
    const text = clean(input);
    return namesAnotherModel(session, modelCodes(text)) || disjoint(typesIn(text), typesIn(session.base)) ? "new" : mode;
  }

  /**
   * The single query line for the proxy, or null when it cannot fit in 160 characters. A refinement is appended to the original
   * description; if the line would be too long the oldest refinements are dropped first (the original description is never dropped).
   * @returns {{query: string, refinements: string[]}|null}
   */
  function composeQuery(session, input, mode) {
    const text = clean(input);
    if (!text) return null;
    if (mode !== "refine" || !session.base) return text.length <= MAX_QUERY_CHARS ? { query: text, refinements: [] } : null;
    const kept = session.refinements.slice(-(MAX_REFINEMENTS - 1));
    for (let drop = 0; drop <= kept.length; drop += 1) {
      const refinements = kept.slice(drop).concat(text);
      const query = [session.base].concat(refinements).join(", ");
      if (query.length <= MAX_QUERY_CHARS) return { query: query, refinements: refinements };
    }
    return null;
  }

  /** The session after a successful research response. `mode` and `composed` are what produced it; `data` is the proxy's response. */
  function adopt(session, mode, input, composed, data) {
    const isRefine = mode === "refine" && session.base;
    return Object.freeze({
      base: isRefine ? session.base : clean(input),
      refinements: Object.freeze(isRefine ? composed.refinements : []),
      pending: Object.freeze(Array.isArray(data.clarify) ? data.clarify.slice(0, 2) : []),
      last: data
    });
  }

  /* ---------- Answers that need no AI call ---------- */

  const TOPICS = Object.freeze([
    ["requirements", /\b(?:requirement|requirements|match|specs?|specifications?|look\s+for|important)\b/i],
    ["differences", /\b(?:differ\w*|compare|comparison|versus|vs|better|worse)\b/i],
    ["why", /\b(?:why|reason|explain|successor|chosen|pick|recommend)\w*/i],
    ["confidence", /\b(?:sure|certain|accurate|accuracy|reliable|trust|verified|confiden\w*|uncertain|right)\b/i],
    ["value", /\b(?:worth|value|valuation|msrp|how much|price range|ballpark|appraisal)\b/i],
    ["buying", /\b(?:price|cost|cheap|cheaper|stock|available|availability|buy|purchase|where|retailer|deal)\b/i]
  ]);

  function candidateOf(data) {
    return [data.successor].concat(data.suggestions || []).filter(Boolean);
  }

  /**
   * An answer to a question about the current results, built only from what the response already says. Returns an array of short
   * paragraphs, or null when the question is not one the results can answer. Never claims price, stock or a verified match.
   */
  function localAnswer(session, input) {
    const data = session.last;
    if (!data) return null;
    // The "value" topic exists only for research.2; a research.1 response answers these questions exactly as it always did.
    const topic = TOPICS.filter(function (entry) { return (entry[0] !== "value" || isV2(data)) && entry[1].test(input); }).map(function (entry) { return entry[0]; })[0];
    const items = candidateOf(data);
    // A candidate named in the question ("what about the Sony?") is answered from that candidate's own details.
    const lower = String(input).toLowerCase();
    const named = items.filter(function (item) {
      const brand = item.name.toLowerCase().split(/[^a-z0-9]+/)[0];
      return Boolean(brand) && new RegExp("\\b" + brand + "\\b").test(lower);
    });
    if (!topic && !named.length) return null;
    if (!topic || (named.length && (topic === "why" || topic === "differences"))) {
      return named.map(function (item) {
        return item.name + ": " + item.why + (item.differences ? " How it differs: " + item.differences : "") + (item.concern ? " Concern: " + item.concern : "");
      });
    }
    if (isV2(data) && (topic === "value" || topic === "buying")) {
      const line = valuationLine(data.pricing.valuation);
      const caution = compatibilityLine(data.pricing.valuation);
      const cited = data.pricing.evidence.length;
      return [line, caution, cited ? "The sources are listed under Pricing & evidence, with the date each was seen." : null, "Check specifications, availability and price with a seller before buying."].filter(Boolean);
    }
    if (topic === "value" || topic === "buying") {
      return ["ItemAssist Research doesn't check prices, stock or where to buy, and none of these candidates is confirmed available. Check specifications, availability and price with a seller before buying."];
    }
    if (topic === "confidence") {
      const level = { HIGH: "high", MEDIUM: "medium", LOW: "low" }[data.original.confidence] || "low";
      return [
        data.original.identity ? "My confidence in the identification is " + level + "." : "I wasn't able to identify the product.",
        data.original.uncertainty || null,
        data.disclosure
      ].filter(Boolean);
    }
    if (topic === "requirements") {
      return data.requirements.length ? ["A replacement should match:"].concat(data.requirements.map(function (item) {
        return typeof item === "string" ? "• " + item : "• " + item.text + " (" + label(IMPORTANCE_LABELS, item.importance, "").toLowerCase() + ")";
      })) : null;
    }
    if (!items.length) return ["I don't have a candidate to explain yet. Add detail such as size, color or finish and I'll research again."];
    if (topic === "differences") {
      return items.map(function (item) { return item.name + ": " + (item.differences || "no specific difference was stated, so check the specifications."); });
    }
    return items.slice(0, 3).map(function (item) {
      return item.name + ": " + item.why + (item.concern ? " Concern: " + item.concern : "");
    });
  }

  /* ---------- Conversation copy ---------- */

  const CATEGORY_LABELS = Object.freeze({ tv: "Television", refrigerator: "Refrigerator", appliance: "Appliance", electronics: "Electronics", other: "Item", unknown: "Item" });

  /**
   * The assistant's reply to a research response as plain data: a tone for styling, a headline, short lines, and the clarifying
   * questions. The page turns it into DOM; nothing here claims anything the response does not.
   */
  function reply(data, quota) {
    const identified = Boolean(data.original && data.original.identity);
    const lines = [];
    let tone = "none";
    let kicker = "ItemAssist Research";
    if (data.status === "UNAVAILABLE") {
      kicker = "Research unavailable";
      lines.push("I couldn't research this one just now, so the panel shows general requirements for this type of item. Nothing there is researched.");
    } else if (!identified) {
      kicker = "Product not identified";
      lines.push("I couldn't identify this item from the description. The panel shows general requirements for this type of item.");
    } else {
      tone = "best";
      lines.push("This looks like " + data.original.identity + (data.original.confidence === "HIGH" ? "." : " (" + data.original.confidence.toLowerCase() + " confidence)."));
      if (data.successor) {
        lines.push("Closest successor to consider: " + data.successor.name + (data.successor.standing === "CONDITIONAL" && (!isV2(data) || data.successor.concern) ? " (with a caveat, see Replacements)." : "."));
      } else {
        lines.push("I couldn't name a direct successor with confidence.");
      }
      const alternatives = (data.suggestions || []).length;
      if (alternatives) lines.push(alternatives === 1 ? "I also found 1 alternative to compare." : "I also found " + alternatives + " alternatives to compare.");
      // research.1 keeps its original punctuation; only research.2 tidies a trailing full stop.
      if (data.original.uncertainty) lines.push("Not sure about: " + (isV2(data) ? data.original.uncertainty.replace(/[.\s]+$/, "") : data.original.uncertainty) + ".");
      if (isV2(data)) {
        candidateOf(data).filter(function (item) { return item.modelStatus === "UNVERIFIED_MODEL"; }).forEach(function (item) {
          lines.push("Exact model identity for " + item.name + " has not been independently confirmed, so treat that model number as unconfirmed.");
        });
        const valueLine = valuationLine(data.pricing.valuation);
        if (valueLine) lines.push(valueLine);
        if (compatibilityLine(data.pricing.valuation)) lines.push(COMPATIBILITY_TEXT);
        const left = shortfallCount(data.pricing.valuation);
        if (left) lines.push(left === 1 ? "I left 1 candidate out of the value range because it falls short of an essential requirement." : "I left " + left + " candidates out of the value range because they fall short of an essential requirement.");
        lines.push("Candidates are suggestions, not confirmed equivalents.");
      } else {
        lines.push("This is an AI estimate and hasn't been verified.");
      }
    }
    const remaining = quota && Number.isFinite(quota.remaining) && Number.isFinite(quota.limit) ? quota : null;
    return {
      tone: tone,
      kicker: kicker,
      lines: lines,
      questions: (data.clarify || []).slice(0, 2),
      quotaLine: remaining ? remaining.remaining + " of " + remaining.limit + " free research requests left today." : null
    };
  }

  /** The right-pane label for the product category. */
  function categoryLabel(category) {
    return Object.prototype.hasOwnProperty.call(CATEGORY_LABELS, category) ? CATEGORY_LABELS[category] : CATEGORY_LABELS.unknown;
  }

  /** A research response is usable only if it has the shape the page renders; anything else is an engine error. */
  function isResearchResponse(body) {
    const common = Boolean(body) && typeof body === "object" && body.kind === "ITEMASSIST_RESEARCH"
      && ["OK", "PARTIAL", "GUIDANCE_ONLY", "UNAVAILABLE"].indexOf(body.status) !== -1
      && Boolean(body.original) && typeof body.original === "object" && Array.isArray(body.requirements) && Array.isArray(body.suggestions)
      && Array.isArray(body.clarify) && Array.isArray(body.warnings) && Boolean(body.meta) && typeof body.disclosure === "string";
    if (!common) return false;
    if (body.contractVersion === "research.1") return true;
    // research.2 also carries the pricing block the report renders; without it the response is not usable.
    const pricing = body.pricing;
    return body.contractVersion === "research.2" && Boolean(pricing) && typeof pricing === "object" && Boolean(pricing.valuation) && typeof pricing.valuation === "object"
      && Array.isArray(pricing.prices) && Array.isArray(pricing.evidence) && Array.isArray(pricing.rejections) && Boolean(pricing.tier)
      && body.requirements.every(function (item) { return Boolean(item) && typeof item === "object" && typeof item.text === "string"; });
  }

  /* ---------- Anonymous visitor ID ---------- */

  function randomId() {
    const cryptoApi = root.crypto || (typeof require === "function" ? require("crypto").webcrypto : null);
    if (cryptoApi && typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID().replace(/-/g, "");
    if (cryptoApi && typeof cryptoApi.getRandomValues === "function") {
      return Array.prototype.map.call(cryptoApi.getRandomValues(new Uint8Array(16)), function (byte) { return ("0" + byte.toString(16)).slice(-2); }).join("");
    }
    return "";
  }

  /**
   * A random first-party ID the browser generates and keeps in its own localStorage: not derived from the device or anything else
   * about the visitor, and sent only to this site's own research route so the daily allowance can be counted. If storage is blocked
   * the ID lives in memory for the page; if even that fails it is omitted and the server falls back to the network address.
   */
  function createVisitorId(storage) {
    let memo = null;
    return function visitorId() {
      if (memo) return memo;
      try {
        const stored = storage && storage.getItem(VISITOR_KEY);
        if (stored && VISITOR_PATTERN.test(stored)) { memo = stored; return stored; }
      } catch (error) { /* storage blocked: fall through */ }
      const fresh = randomId();
      if (!VISITOR_PATTERN.test(fresh)) return "";
      memo = fresh;
      try { if (storage) storage.setItem(VISITOR_KEY, fresh); } catch (error) { /* memory only */ }
      return fresh;
    };
  }

  const api = {
    MAX_QUERY_CHARS: MAX_QUERY_CHARS, VISITOR_KEY: VISITOR_KEY, VISITOR_PATTERN: VISITOR_PATTERN,
    SUMMARY_TITLE: SUMMARY_TITLE, SUMMARY_NOTE: SUMMARY_NOTE, DEMO_LABEL: DEMO_LABEL, GREETING: GREETING, PLACEHOLDER: PLACEHOLDER, FINEPRINT: FINEPRINT, FINEPRINT_V2: FINEPRINT_V2, ASK_WHICH: ASK_WHICH, ASK_ACCESSORY: ASK_ACCESSORY, STAY_ON_ITEM: STAY_ON_ITEM, FALLBACK_HELP: FALLBACK_HELP, TOO_LONG: TOO_LONG, STARTING_FRESH: STARTING_FRESH,
    ERROR_MESSAGES: ERROR_MESSAGES, errorMessage: errorMessage, offersClassic: offersClassic,
    initialSession: initialSession, classify: classify, turnIntent: turnIntent, resolveMode: resolveMode, composeQuery: composeQuery, adopt: adopt, localAnswer: localAnswer,
    reply: reply, categoryLabel: categoryLabel, isResearchResponse: isResearchResponse, createVisitorId: createVisitorId, modelCodes: modelCodes,
    isV2: isV2, SUMMARY_NOTE_V2: SUMMARY_NOTE_V2, DEMO_PRICE_NOTE: DEMO_PRICE_NOTE, label: label, noteText: noteText, formatMoney: formatMoney, formatRange: formatRange, formatDay: formatDay,
    valuationLine: valuationLine, compatibilityLine: compatibilityLine, isListingAnchor: isListingAnchor, shortfallCount: shortfallCount, referencePrice: referencePrice, originalPrices: originalPrices, historySummary: historySummary, priceRole: priceRole, pricesByRole: pricesByRole,
    PRICE_ROLE_LABELS: PRICE_ROLE_LABELS, PRICE_ROLE_REASONS: PRICE_ROLE_REASONS,
    PRICE_KIND_LABELS: PRICE_KIND_LABELS, VERIFICATION_LABELS: VERIFICATION_LABELS, DATE_LABELS: DATE_LABELS, METHOD_LABELS: METHOD_LABELS, TIER_LABELS: TIER_LABELS,
    TIER_BASIS_LABELS: TIER_BASIS_LABELS, IMPORTANCE_LABELS: IMPORTANCE_LABELS, ORIGIN_LABELS: ORIGIN_LABELS, COMPARISON_LABELS: COMPARISON_LABELS, BASIS_LABELS: BASIS_LABELS,
    MODEL_STATUS_LABELS: MODEL_STATUS_LABELS, SOURCE_CLASS_LABELS: SOURCE_CLASS_LABELS, MODEL_RELATION_LABELS: MODEL_RELATION_LABELS, EXCLUSION_LABELS: EXCLUSION_LABELS,
    REJECTION_REASON_LABELS: REJECTION_REASON_LABELS, REJECTION_ACTION_LABELS: REJECTION_ACTION_LABELS, CANDIDATE_LABELS: CANDIDATE_LABELS, NOTE_TEXT: NOTE_TEXT
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.RFResearch = api;
})(typeof window !== "undefined" ? window : globalThis);
