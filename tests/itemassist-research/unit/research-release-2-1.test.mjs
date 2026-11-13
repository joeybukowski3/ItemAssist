import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";

// OFFLINE ONLY. Release 2.1, this side: the chat and the cards say the same thing about a candidate's generation and model; AI-estimated characteristics are labelled as such;
// and the original's historical list price is never turned into a percentage of a present-day listing. Fixtures are two SAVED PRODUCTION responses (the cached "LG C3 55-inch
// TV" answer and the fresh "LG OLED55C3PUA" answer, request ids replaced) plus the Release 2 engine fixtures; nothing calls a provider.
const require = createRequire(import.meta.url);
const RS = require("../../../assets/js/rf-research.js");
const { projectResearch } = require("../../../api/_lib/itemassist-research/projection.js");

const production = (name) => JSON.parse(readFileSync(new URL(`../fixtures/production/${name}.json`, import.meta.url), "utf8"));
const engine = (name) => JSON.parse(readFileSync(new URL(`../fixtures/successor/${name}.engine.json`, import.meta.url), "utf8"));
const project = (body) => projectResearch(JSON.parse(JSON.stringify(body)), { requestId: "req-1", elapsedMs: 5, quota: null, allowLive: true });
const clone = (value) => JSON.parse(JSON.stringify(value));
const PRODUCTION = ["lg-c3-55-tv-cached", "lg-oled55c3pua-fresh"];
const asked = (data, text) => RS.localAnswer({ last: data }, text);
const model = (data) => asked(data, "What is the exact model number?");
const chatText = (data) => [...RS.reply(data, data.quota).lines, ...(model(data) || [])].join("\n");
const withLineage = (data, lineage) => { const copy = clone(data); copy.successor.lineage = lineage; return copy; };

test("the saved Production responses are valid research.2 and carry the C6 generation from listings with no observed model code", () => {
  for (const name of PRODUCTION) {
    const data = production(name);
    assert.equal(RS.isResearchResponse(data), true, name);
    assert.deepEqual([data.successor.lineage.generation, data.successor.lineage.basis, data.successor.modelStatus], ["C6", "LISTINGS", "FAMILY_LEVEL"], name);
    assert.equal(Object.hasOwn(data.successor, "modelObservations"), false, name);
  }
});

// ---- the chat acknowledges a generation the structured lineage establishes ------------------------------------------------------------------------------------------

test("known generation, unknown exact model: the chat says the generation is known and the exact model is not (the canary contradiction)", () => {
  for (const name of PRODUCTION) {
    const data = production(name);
    const [successor] = model(data);
    assert.match(successor, /^LG C6 .*: Retailer listings identify generation C6, but I couldn't confirm the exact model code from the available listings\.$/, name);
    const summary = RS.reply(data, data.quota).lines.find((line) => line.startsWith("Likely successor"));
    assert.equal(/couldn't identify its generation/.test(summary), false, `${name}: the summary no longer says the generation is unknown`);
    assert.match(summary, /generation C6/);
    assert.match(summary, /couldn't confirm the exact model/);
    assert.match(summary, /treat it as a family, not a specific model/);
    assert.equal(RS.generationLine(data.successor), "Generation C6, as stated in retailer listings.", `${name}: the card's line`);
  }
});

test("the chat reads the lineage fields, not the card text: only a candidate with a stated generation gets the generation sentence", () => {
  const data = production("lg-oled55c3pua-fresh");
  const [, sony, samsung] = model(data);
  for (const line of [sony, samsung]) assert.match(line, /: no model code was seen in the listings I found, so the exact model is not established\.$/, "other brands keep the conservative answer");
  assert.equal(/generation/i.test(sony + samsung), false);
});

test("a generation that is only the AI's guess is described as a guess, never as retailer evidence", () => {
  const data = withLineage(production("lg-oled55c3pua-fresh"), { relation: "SAME_SERIES_NEWER", generation: "C6", basis: "AI_HYPOTHESIS", tier: "SAME" });
  const [successor] = model(data);
  assert.match(successor, /Generation C6 is the AI's guess; no listing states it/);
  assert.match(successor, /exact model is not established/);
  assert.equal(/Retailer listings identify/.test(successor), false);
  const summary = RS.reply(data, data.quota).lines.find((line) => line.startsWith("Likely successor"));
  assert.match(summary, /AI's guess/);
  assert.equal(/Retailer listings identify|as stated in retailer listings/.test(summary), false);
});

test("unknown generation and unknown model: the existing conservative wording is kept", () => {
  const data = withLineage(production("lg-oled55c3pua-fresh"), { relation: "UNKNOWN", generation: null, basis: "NONE", tier: "SAME" });
  assert.match(model(data)[0], /^LG C6 OLED TV 55-inch: no model code was seen in the listings I found, so the exact model is not established\.$/);
  const summary = RS.reply(data, data.quota).lines.find((line) => line.startsWith("Likely successor"));
  assert.match(summary, /I couldn't identify its generation or exact model, so treat it as a family, not a specific model\./);
  const noLineage = clone(production("lg-oled55c3pua-fresh"));
  delete noLineage.successor.lineage;
  assert.match(model(noLineage)[0], /no model code was seen/);
  assert.match(RS.reply(noLineage, noLineage.quota).lines.find((line) => line.startsWith("Likely successor")), /couldn't identify its generation or exact model/);
});

test("observed code, unverified exact model: the generation, the observation and the distinction between observed and verified are all stated", () => {
  const data = project(engine("lg-c3-r2-bundle-only"));
  const [successor] = model(data);
  assert.match(successor, /Retailer listings identify generation C6\./);
  assert.match(successor, /Model code observed: OLED55C6PUA/);
  assert.match(successor, /Price excluded: the listing includes a protection plan\./);
  assert.match(successor, /does not verify the model or its specifications/);
  assert.equal(/couldn't confirm the exact model code/.test(successor), false, "a code WAS observed, so the 'could not confirm a code' sentence is not used");
  assert.equal(data.successor.modelStatus, "UNVERIFIED_MODEL");
  assert.match(RS.observationLines(data.successor).join(" "), /Model code observed: OLED55C6PUA/, "the card's lines are the same ones the chat uses");
});

test("conflicting codes: the conflict is stated and no code or generation claim hides it", () => {
  const data = project(engine("lg-c3-r2-conflict"));
  const [successor] = model(data);
  assert.match(successor, /more than one model code \(OLED55C6PUA, OLED55C6AUA\), so none is chosen/);
});

// ---- chat and card never disagree about whether a generation is known --------------------------------------------------------------------------------------------------

test("across every saved fixture: no chat sentence calls a generation unknown when the candidate's lineage states one", () => {
  const sources = [...PRODUCTION.map(production)];
  for (const file of readdirSync(new URL("../fixtures/successor/", import.meta.url)).filter((name) => name.endsWith(".engine.json"))) {
    const out = project(engine(file.replace(".engine.json", "")));
    if (out && RS.isV2(out)) sources.push(out);
  }
  assert.ok(sources.length >= 10, "a broad set of saved answers");
  let checked = 0;
  for (const data of sources) {
    for (const item of [data.successor].filter(Boolean)) {
      if (!item.lineage || !item.lineage.generation) continue;
      checked += 1;
      const lines = [RS.successorLine(data), ...(model({ ...data, successor: item, suggestions: [] }) || [])].join("\n");
      assert.equal(/couldn't identify its generation|I couldn't identify its generation/.test(lines), false, `${item.name}: ${lines}`);
      assert.ok(RS.generationLine(item), `${item.name}: the card states the generation the chat acknowledges`);
    }
  }
  assert.ok(checked >= 5, `${checked} candidates with a stated generation were checked`);
});

// ---- AI-estimated characteristics are labelled as estimates ------------------------------------------------------------------------------------------------------------

test("the original's characteristics are labelled as the model's estimate, and the note points to the sourced comparison", () => {
  assert.equal(typeof RS.CHARACTERISTICS_LABEL, "string");
  assert.match(RS.CHARACTERISTICS_LABEL, /^Key characteristics \(AI estimate\)$/);
  assert.match(RS.CHARACTERISTICS_NOTE, /general knowledge/i);
  assert.match(RS.CHARACTERISTICS_NOTE, /not verified/i);
  assert.match(RS.CHARACTERISTICS_NOTE, /specification comparison/i);
  assert.equal(/verified specification|confirmed/i.test(RS.CHARACTERISTICS_LABEL), false);
});

// ---- the original's list price is context, never a percentage of today's listing ---------------------------------------------------------------------------------------

test("CURRENT_BELOW_ORIGINAL (still sent by an engine that predates 2.1, and held in cached answers) is not shown as a sentence", () => {
  assert.equal(RS.noteText({ code: "CURRENT_BELOW_ORIGINAL", ratio: 0.54 }), null);
  const data = production("lg-oled55c3pua-fresh");
  assert.ok(data.pricing.valuation.notes.some((note) => note.code === "CURRENT_BELOW_ORIGINAL"), "the saved Production answer does carry the note");
  const shown = data.pricing.valuation.notes.map((note) => RS.noteText(note, { referenceKind: data.pricing.valuation.reference?.kind })).filter(Boolean).join("\n");
  assert.equal(/%|of the original's list price|54/.test(shown), false, shown);
});

test("the original's list price remains dated context for a different model, qualified and never compared with today's price", () => {
  const text = RS.noteText({ code: "MSRP_CONTEXT_ONLY" }, { referenceKind: "MSRP" });
  assert.match(text, /^The original's list price is context only\. It does not set the replacement range\./, "the existing sentence is unchanged");
  assert.match(text, /past price for a different model/);
  assert.match(text, /not compared with today's listings/);
  assert.match(RS.noteText({ code: "MSRP_CONTEXT_ONLY" }, { referenceKind: "HISTORICAL_RETAIL" }), /^The original's past retail price is context only\./);
  const data = production("lg-oled55c3pua-fresh");
  const reference = data.pricing.prices.find((price) => price.id === data.pricing.valuation.reference.priceId);
  assert.deepEqual([reference.kind, reference.subject, reference.asOf, reference.asOfBasis, reference.amount.low], ["MSRP", "ORIGINAL", "2023-04-14", "PUBLISHED", 1899.99]);
});

// ---- pricing safeguards are unchanged -----------------------------------------------------------------------------------------------------------------------------------

test("pricing wording and scope are unchanged for the saved Production answers", () => {
  const data = production("lg-oled55c3pua-fresh");
  const lines = RS.reply(data, data.quota).lines.join("\n");
  assert.match(lines, /One retailer listing shows \$1,025, as of Nov 13, 2026\. It is a single listing price, not confirmed on the product page, and not a value range\./);
  assert.match(lines, /Scope: one retailer listing that does not state its exact model, so it cannot be tied to one specific model\./);
  assert.deepEqual(data.pricing.valuation.range, { currency: "USD", low: 1025, high: 1025 });
  assert.equal(data.pricing.valuation.verified, false);
});
