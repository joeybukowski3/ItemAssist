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
  // Spec and feature tokens are not model codes ("4k", "120hz", "hdr10"); a model code mixes letters and digits ("c3", "qn55q80c").
  const SPEC_TOKEN = /^\d+(?:k|p|x|hz|gb|tb|mb|w|v|l|mm|cm|in|ft|lb|lbs|cu|ms|nits)$/;
  const FEATURE_TOKEN = /^(?:hdr|hdmi|wifi|usb|gen|dolby|atmos|bt|cat)\d*\+?$/;

  /* ---------- Wording ---------- */

  // The banner above the report: what kind of result this is, stated once and plainly.
  const SUMMARY_TITLE = "AI Research Summary";
  const SUMMARY_NOTE = "Specifications and replacement suggestions are preliminary and not independently verified. Availability and pricing are not checked.";
  const GREETING ="Describe the item you're replacing: a brand and model number, or a short description. I'll identify it, outline what a replacement should match, and suggest candidates to explore.";
  const PLACEHOLDER = "Describe the item or answer my question...";
  const FINEPRINT = "ItemAssist Research gives AI estimates from general product knowledge. Specifications, availability and pricing are not verified; confirm them before buying.";
  const ASK_WHICH = "Is that more detail about this item, or a different item?";
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
    ["phone", /\b(?:phone|smartphone|iphone)\b/], ["hvac", /\b(?:furnace|hvac|air conditioner|heat pump)\b/], ["water heater", /\bwater heaters?\b/]
  ];

  const brandsIn = (text) => clean(text).toLowerCase().split(/[^a-z0-9]+/).filter(function (word) { return BRANDS.indexOf(word) !== -1; });
  const typesIn = (text) => TYPES.filter(function (entry) { return entry[1].test(clean(text).toLowerCase()); }).map(function (entry) { return entry[0]; });
  const disjoint = (a, b) => a.length > 0 && b.length > 0 && !a.some(function (item) { return b.indexOf(item) !== -1; });

  /**
   * What a typed message is, decided without any AI call.
   *   empty    nothing to do
   *   reset    "new research" with no item: start fresh and ask for one
   *   new      a new item (text is the description, with any "new research:" prefix removed)
   *   refine   more detail on the current item
   *   question a question about the current results, answered locally from them
   *   ask      ambiguous: the page asks which of refine / new was meant
   */
  function classify(session, input) {
    const text = clean(input);
    if (!text) return { kind: "empty" };
    const marker = NEW_PATTERN.exec(text);
    if (marker) {
      const rest = text.slice(marker[0].length).trim();
      return rest ? { kind: "new", text: rest } : { kind: "reset" };
    }
    if (!session.base) return { kind: "new", text: text };
    const codes = modelCodes(text);
    const baseCodes = modelCodes(session.base);
    // Explicitly naming a different product wins over any open question, and over a question's phrasing:
    //  - a model code that matches none of the current item's codes (a code when the item had none is just a detail), or
    //  - a different kind of product (a refrigerator when researching a TV).
    if (codes.length && baseCodes.length && !codes.some(function (code) { return baseCodes.some(function (base) { return sameCode(code, base); }); })) {
      return { kind: "new", text: text };
    }
    if (disjoint(typesIn(text), typesIn(session.base))) return { kind: "new", text: text };
    // Only a different brand: it could be a different item or a preference ("I'd like a Samsung"), so the page asks instead of guessing.
    // The exception is a question about a candidate the results already name ("what's different about the Sony?").
    if (disjoint(brandsIn(text), brandsIn(session.base))) {
      const candidates = session.last ? candidateOf(session.last).map(function (item) { return item.name; }).join(" ") : "";
      const aboutACandidate = QUESTION_PATTERN.test(text) && !disjoint(brandsIn(text), brandsIn(candidates));
      if (!aboutACandidate) return { kind: "ask", text: text };
    }
    if (session.last && QUESTION_PATTERN.test(text)) return { kind: "question", text: text };
    if (session.pending.length && text.length <= CLARIFY_REPLY_CHARS) return { kind: "refine", text: text };
    if (text.length <= SHORT_REPLY_CHARS) return { kind: "refine", text: text };
    return { kind: "ask", text: text };
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
    const topic = TOPICS.filter(function (entry) { return entry[1].test(input); }).map(function (entry) { return entry[0]; })[0];
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
    if (topic === "buying") {
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
      return data.requirements.length ? ["A replacement should match:"].concat(data.requirements.map(function (item) { return "• " + item; })) : null;
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
        lines.push("Closest successor to consider: " + data.successor.name + (data.successor.standing === "CONDITIONAL" ? " (with a caveat, see Replacements)." : "."));
      } else {
        lines.push("I couldn't name a direct successor with confidence.");
      }
      const alternatives = (data.suggestions || []).length;
      if (alternatives) lines.push(alternatives === 1 ? "I also found 1 alternative to compare." : "I also found " + alternatives + " alternatives to compare.");
      if (data.original.uncertainty) lines.push("Not sure about: " + data.original.uncertainty + ".");
      lines.push("This is an AI estimate and hasn't been verified.");
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
    return Boolean(body) && typeof body === "object" && body.contractVersion === "research.1" && body.kind === "ITEMASSIST_RESEARCH"
      && ["OK", "PARTIAL", "GUIDANCE_ONLY", "UNAVAILABLE"].indexOf(body.status) !== -1
      && Boolean(body.original) && typeof body.original === "object" && Array.isArray(body.requirements) && Array.isArray(body.suggestions)
      && Array.isArray(body.clarify) && Array.isArray(body.warnings) && Boolean(body.meta) && typeof body.disclosure === "string";
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
    SUMMARY_TITLE: SUMMARY_TITLE, SUMMARY_NOTE: SUMMARY_NOTE, GREETING: GREETING, PLACEHOLDER: PLACEHOLDER, FINEPRINT: FINEPRINT, ASK_WHICH: ASK_WHICH, FALLBACK_HELP: FALLBACK_HELP, TOO_LONG: TOO_LONG, STARTING_FRESH: STARTING_FRESH,
    ERROR_MESSAGES: ERROR_MESSAGES, errorMessage: errorMessage, offersClassic: offersClassic,
    initialSession: initialSession, classify: classify, composeQuery: composeQuery, adopt: adopt, localAnswer: localAnswer,
    reply: reply, categoryLabel: categoryLabel, isResearchResponse: isResearchResponse, createVisitorId: createVisitorId, modelCodes: modelCodes
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.RFResearch = api;
})(typeof window !== "undefined" ? window : globalThis);
