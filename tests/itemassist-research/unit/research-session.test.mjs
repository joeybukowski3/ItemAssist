import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const RS = require("../../../assets/js/rf-research.js");
const { researchResponse, researchGuidance } = require("../fixtures/research.js");

const empty = RS.initialSession();
const composedFor = (session, mode, text) => RS.composeQuery(session, text, mode);
/** A session that has researched `base` and was left with the fixture's clarifying question. */
const researched = (base = "LG C3 OLED TV", data = researchResponse()) => RS.adopt(empty, "new", base, composedFor(empty, "new", base), data);

// ---- classification (no AI call decides any of this) --------------------------------------------------------------------------

test("with no current item, any text is a new item", () => {
  assert.deepEqual(RS.classify(empty, "LG C3 OLED TV"), { kind: "new", text: "LG C3 OLED TV" });
  assert.equal(RS.classify(empty, "   ").kind, "empty");
});

test('"new research" starts over: bare, it resets; with an item after it, that item is the new description', () => {
  const session = researched();
  for (const bare of ["new research", "Start over", "reset", "different item", "never mind"]) assert.equal(RS.classify(session, bare).kind, "reset", bare);
  assert.deepEqual(RS.classify(session, "new research: Samsung QN55Q80C"), { kind: "new", text: "Samsung QN55Q80C" });
  assert.deepEqual(RS.classify(session, "Start over - GE dishwasher GDF510"), { kind: "new", text: "GE dishwasher GDF510" });
});

test("a short reply, or any reply to an open question, is more detail on the current item", () => {
  const session = researched();
  for (const reply of ["65 inch", "the 65", "stainless", "it is a 2023 model", "about 55 inches, wall mounted in the den"]) assert.equal(RS.classify(session, reply).kind, "refine", reply);
});

test("a model code that matches none of the current item's codes is a different item, even if worded as a question", () => {
  const session = researched("LG C3 OLED TV");
  assert.equal(RS.classify(session, "Samsung QN55Q80C").kind, "new");
  assert.equal(RS.classify(session, "what about the Sony A95L?").kind, "new");
  assert.equal(RS.classify(session, "it is the LG C3 in 65 inch").kind, "refine", "the same code is a detail");
  const noCode = researched("old LG OLED tv");
  assert.equal(RS.classify(noCode, "C3").kind, "refine", "a code when the item had none is a detail");
});

test("explicitly naming a different product wins over an open clarification question; real answers to the question still refine", () => {
  const session = researched("LG C3 OLED TV");
  assert.equal(session.pending.length, 1, "a clarification question is open");
  for (const different of ["Samsung QN55Q80C", "GE refrigerator GFE28", "my dishwasher is broken too", "a Whirlpool washer", "Dell XPS laptop"]) {
    assert.equal(RS.classify(session, different).kind, "new", different);
  }
  for (const answer of ["65 inch", "55", "the 65 inch one", "it's a 2023 TV", "LG", "about 65 inches, black frame", "I have an OLED"]) {
    assert.equal(RS.classify(session, answer).kind, "refine", answer);
  }
});

test("a different brand alone is ambiguous (a different item or a preference), so the page asks instead of guessing", () => {
  const session = researched("LG C3 OLED TV");
  for (const text of ["I'd like a Samsung", "Samsung TV", "Sony Bravia 8 OLED"]) assert.equal(RS.classify(session, text).kind, "ask", text);
  // A question about a candidate the results already name is part of this conversation: it is answered locally from that candidate.
  assert.equal(RS.classify(session, "what about Sony?").kind, "question");
  assert.match(RS.localAnswer(session, "what about Sony?").join(" "), /Sony Bravia 8 OLED: Similar tier with strong processing\. How it differs: Fewer gaming features/);
  assert.equal(RS.localAnswer(session, "what about Vizio?"), null, "a brand that is not in the results has nothing to answer from");
  assert.equal(RS.classify(session, "LG").kind, "refine", "the same brand is a detail");
  assert.equal(RS.classify(empty, "I'd like a Samsung").kind, "new", "with no current item there is nothing to refine");
});

test("questions about the results are answered locally, never sent as research", () => {
  const session = researched();
  for (const text of ["why is the successor conditional?", "What's different about the Sony?", "how sure are you?", "where can I buy it?", "Explain the requirements"]) {
    assert.equal(RS.classify(session, text).kind, "question", text);
  }
});

test("a long message that is neither clearly detail nor a new item asks which; the page never guesses", () => {
  const longDetail = "I measured the opening and it is about 56 inches wide with a shelf above it and a cable box below";
  const session = RS.adopt(empty, "new", "LG C3 OLED TV", composedFor(empty, "new", "LG C3 OLED TV"), researchResponse({ clarify: [] }));
  assert.equal(RS.classify(session, longDetail).kind, "ask");
});

// ---- composing the query -----------------------------------------------------------------------------------------------------

test("a new item is the query as typed; one over 160 characters cannot be sent", () => {
  assert.deepEqual(composedFor(empty, "new", "LG C3 OLED TV"), { query: "LG C3 OLED TV", refinements: [] });
  assert.equal(composedFor(empty, "new", "x".repeat(161)), null);
  assert.notEqual(composedFor(empty, "new", "x".repeat(160)), null);
});

test("a refinement is appended to the original description, so the conversation refines one query", () => {
  const first = researched("LG C3 OLED TV");
  const one = composedFor(first, "refine", "65 inch");
  assert.equal(one.query, "LG C3 OLED TV, 65 inch");
  const second = RS.adopt(first, "refine", "65 inch", one, researchResponse({ clarify: [] }));
  assert.equal(composedFor(second, "refine", "wall mounted").query, "LG C3 OLED TV, 65 inch, wall mounted");
  assert.equal(second.base, "LG C3 OLED TV", "the original description is kept");
});

test("when a refinement would not fit, the oldest refinements are dropped first and the original is never dropped", () => {
  let session = researched("LG C3 OLED TV");
  const details = ["65 inch screen wanted for the living room", "wall mounted above the fireplace in the den", "bought new in the spring of 2023",
    "needs four HDMI 2.1 ports for game consoles", "prefers a black frame with thin bezels", "no glare because of the big south windows"];
  details.forEach((detail) => {
    const composed = composedFor(session, "refine", detail);
    assert.ok(composed, detail);
    assert.ok(composed.query.length <= RS.MAX_QUERY_CHARS);
    assert.ok(composed.query.startsWith("LG C3 OLED TV"));
    assert.ok(composed.query.endsWith(detail), "the newest detail is always kept");
    session = RS.adopt(session, "refine", detail, composed, researchResponse({ clarify: [] }));
  });
  assert.ok(session.refinements.length < details.length, "older refinements were dropped to stay within the limit");
  assert.equal(composedFor(session, "refine", "x".repeat(150)), null, "even the original plus this detail does not fit");
});

test("adopting a new item replaces the session; adopting a refinement keeps the base; the open questions follow the response", () => {
  const first = researched("LG C3 OLED TV");
  assert.deepEqual([...first.pending], ["Which screen size do you have?"]);
  const switched = RS.adopt(first, "new", "Samsung QN55Q80C", composedFor(first, "new", "Samsung QN55Q80C"), researchResponse({ clarify: [] }));
  assert.deepEqual([switched.base, [...switched.refinements], [...switched.pending]], ["Samsung QN55Q80C", [], []]);
  assert.throws(() => { first.base = "mutated"; }, TypeError, "sessions are immutable");
});

// ---- answers that need no AI call --------------------------------------------------------------------------------------------

test("local answers come only from the current results and never claim price, stock or a verified match", () => {
  const session = researched();
  const why = RS.localAnswer(session, "why is it the successor?").join(" ");
  assert.match(why, /Direct successor line/);
  assert.match(why, /Concern: Fewer HDMI 2.1 ports/);
  const diff = RS.localAnswer(session, "what is different about each?").join(" ");
  assert.match(diff, /Brighter panel, newer processor/);
  assert.match(diff, /Different smart platform/);
  const sure = RS.localAnswer(session, "how sure are you?").join(" ");
  assert.match(sure, /confidence in the identification is high/);
  assert.match(sure, /Screen size was not given/);
  assert.match(sure, /not been verified/);
  const buying = RS.localAnswer(session, "where can I buy it and how much is it?").join(" ");
  assert.match(buying, /doesn't check prices, stock or where to buy/);
  assert.equal(/\$\d|in stock|available at|guarantee|lkq/i.test([why, diff, sure, buying].join(" ")), false);
  assert.equal(RS.localAnswer(session, "tell me a joke"), null);
  assert.equal(RS.localAnswer(empty, "why?"), null);
});

test("a local answer for a result with no candidates says so instead of inventing one", () => {
  const session = RS.adopt(empty, "new", "mystery gadget", composedFor(empty, "new", "mystery gadget"), researchGuidance());
  assert.match(RS.localAnswer(session, "why this one?").join(" "), /don't have a candidate/);
});

// ---- the assistant's reply ----------------------------------------------------------------------------------------------------

test("the reply states the identification, the successor with its caveat, the alternatives, what is uncertain, and what is left today", () => {
  const reply = RS.reply(researchResponse(), { limit: 5, remaining: 4, charged: true });
  const text = reply.lines.join(" ");
  assert.equal(reply.tone, "best");
  assert.match(text, /This looks like LG C3 series 4K OLED smart TV\./);
  assert.match(text, /Closest successor to consider: LG C-series OLED, next generation \(with a caveat/);
  assert.match(text, /2 alternatives/);
  assert.match(text, /Not sure about: Screen size was not given/);
  assert.match(text, /AI estimate and hasn't been verified/);
  assert.deepEqual(reply.questions, ["Which screen size do you have?"]);
  assert.equal(reply.quotaLine, "4 of 5 free research requests left today.");
});

test("a failed or unidentified result is described honestly: nothing is presented as researched", () => {
  const failed = RS.reply(researchGuidance(), { limit: 5, remaining: 5 });
  assert.equal(failed.tone, "none");
  assert.equal(failed.kicker, "Research unavailable");
  assert.match(failed.lines.join(" "), /Nothing there is researched/);
  const unidentified = RS.reply(researchResponse({ status: "GUIDANCE_ONLY", original: { identity: null, confidence: "LOW", characteristics: [], uncertainty: null }, successor: null, suggestions: [] }), null);
  assert.equal(unidentified.kicker, "Product not identified");
  assert.equal(unidentified.quotaLine, null);
});

test("customer wording: ItemAssist Research, never the retired name, and no LKQ, verified-match, price or availability claim", () => {
  assert.equal(RS.SUMMARY_TITLE, "AI Research Summary");
  assert.match(RS.SUMMARY_NOTE, /preliminary and not independently verified/);
  const copy = [RS.SUMMARY_TITLE, RS.SUMMARY_NOTE, RS.GREETING, RS.PLACEHOLDER, RS.FINEPRINT, RS.ASK_WHICH, RS.FALLBACK_HELP, RS.TOO_LONG, RS.STARTING_FRESH, ...Object.values(RS.ERROR_MESSAGES),
    ...RS.reply(researchResponse(), { limit: 5, remaining: 3 }).lines, ...RS.reply(researchGuidance(), null).lines].join("\n");
  assert.equal(/quick ai estimate/i.test(copy), false);
  assert.equal(/\blkq\b|like[- ]kind|certified|guaranteed|confirmed (?:match|equivalent)|verified (?:match|equivalent)|in stock|\$\d/i.test(copy), false);
  assert.match(RS.FINEPRINT, /not verified/);
});

// ---- errors, response check, visitor ID --------------------------------------------------------------------------------------

test("every proxy error code has fixed, non-sensitive wording; unknown codes fall back to a generic message", () => {
  for (const code of ["API_DISABLED", "INVALID_REQUEST", "RATE_LIMITED", "QUOTA_EXCEEDED", "SERVICE_UNAVAILABLE", "CAPACITY_REACHED", "ENGINE_TIMEOUT", "ENGINE_ERROR", "NETWORK_ERROR"]) {
    assert.ok(RS.errorMessage(code).length > 10, code);
  }
  assert.equal(RS.errorMessage("something-new"), RS.ERROR_MESSAGES.ENGINE_ERROR);
  assert.equal(RS.errorMessage("__proto__"), RS.ERROR_MESSAGES.ENGINE_ERROR);
});

test("the classic lookup is offered after an outage or failure, never after a quota or rate limit (it is not a way around either)", () => {
  for (const code of ["API_DISABLED", "SERVICE_UNAVAILABLE", "ENGINE_TIMEOUT", "ENGINE_ERROR", "NETWORK_ERROR", "CAPACITY_REACHED"]) assert.equal(RS.offersClassic(code), true, code);
  for (const code of ["QUOTA_EXCEEDED", "RATE_LIMITED", "INVALID_REQUEST"]) assert.equal(RS.offersClassic(code), false, code);
});

test("only a research.1 response with the expected shape is usable", () => {
  assert.equal(RS.isResearchResponse(researchResponse()), true);
  assert.equal(RS.isResearchResponse(researchGuidance()), true);
  for (const bad of [null, undefined, "x", [], {}, { ...researchResponse(), contractVersion: "1" }, { ...researchResponse(), kind: "REPLACEMENT" }, { ...researchResponse(), status: "COMPLETE" },
    { ...researchResponse(), original: null }, { ...researchResponse(), suggestions: "none" }, { ...researchResponse(), meta: undefined }]) {
    assert.equal(RS.isResearchResponse(bad), false, JSON.stringify(bad)?.slice(0, 60));
  }
});

test("the visitor ID is random, valid, stable and stored only in the browser's own storage; blocked storage still works", () => {
  const store = new Map();
  const storage = { getItem: (key) => (store.has(key) ? store.get(key) : null), setItem: (key, value) => store.set(key, value) };
  const first = RS.createVisitorId(storage)();
  assert.match(first, RS.VISITOR_PATTERN);
  assert.equal(store.get(RS.VISITOR_KEY), first);
  assert.equal(RS.createVisitorId(storage)(), first, "a new page load reuses the stored ID");
  assert.notEqual(RS.createVisitorId({ getItem: () => null, setItem: () => {} })(), first);
  const blocked = RS.createVisitorId({ getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } });
  const memo = blocked();
  assert.match(memo, RS.VISITOR_PATTERN);
  assert.equal(blocked(), memo, "stable for the page when storage is blocked");
  assert.match(RS.createVisitorId(null)(), RS.VISITOR_PATTERN);
  store.set(RS.VISITOR_KEY, "short");
  assert.notEqual(RS.createVisitorId(storage)(), "short", "a malformed stored value is replaced");
});
