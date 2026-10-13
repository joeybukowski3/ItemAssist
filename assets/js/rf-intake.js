/*
 * Conversational intake for the ItemAssist workspace: turns a typed message into the same { category, brand, model, notes } a
 * structured lookup sends, or into one short follow-up question. Pure and dependency-free (apart from rf-shared.js), loaded by
 * <script> in the browser (window.RFIntake) and required directly by Node tests.
 *
 * This is deterministic parsing, not a chat backend. It never calls the network, never scores or matches products, and never
 * invents a model number: the only model it composes is Samsung's published "QN<size><series>" form, and only when the user gave
 * both. Supported brands and categories come from RFShared.SUPPORT; the patterns below are intake hints only. The server stays
 * authoritative: every payload built here still goes through RFShared.validateLookup and the proxy, and its answer wins.
 */
(function (root) {
  "use strict";

  const RF = typeof module === "object" && module.exports ? require("./rf-shared.js") : root.RFShared;

  /* ---------- State machine ---------- */

  const STATUS = Object.freeze({
    IDLE: "IDLE", PARSED: "PARSED", NEEDS_CLARIFICATION: "NEEDS_CLARIFICATION", READY: "READY",
    RESEARCHING: "RESEARCHING", RESULT: "RESULT", ERROR: "ERROR"
  });
  // RESEARCHING is also reachable straight from IDLE and the settled states: the structured form starts a lookup without chat intake.
  const TRANSITIONS = Object.freeze({
    IDLE: ["PARSED", "RESEARCHING"],
    PARSED: ["NEEDS_CLARIFICATION", "READY", "IDLE"],
    NEEDS_CLARIFICATION: ["PARSED", "IDLE", "RESEARCHING"],
    READY: ["RESEARCHING", "IDLE"],
    RESEARCHING: ["RESULT", "ERROR", "IDLE"],
    RESULT: ["IDLE", "PARSED", "RESEARCHING"],
    ERROR: ["IDLE", "PARSED", "RESEARCHING"]
  });

  function canTransition(from, to) {
    return Object.prototype.hasOwnProperty.call(TRANSITIONS, from) && TRANSITIONS[from].indexOf(to) !== -1;
  }

  function initialState() {
    return Object.freeze({ status: STATUS.IDLE, draft: null, pending: null });
  }

  /** A new state, or the same one when the move is not legal (a late or duplicate event never corrupts the flow). */
  function moveTo(state, status, extra) {
    if (!canTransition(state.status, status)) return state;
    return Object.freeze(Object.assign({}, state, extra || {}, { status: status }));
  }

  /* ---------- Vocabulary ---------- */

  // Intake hints per supported category. A category in RFShared.SUPPORT without an entry here simply cannot be inferred from a model.
  const FAMILIES = Object.freeze({
    television: Object.freeze({
      // Samsung "QN55Q80C", "UN55CU7000", "QN55Q80CAFXZA": size in inches, then the series and revision.
      model: /^(?:QN|UN)\d{2}[A-Z][A-Z0-9]{1,11}$/,
      // "Q80C": a QLED series with no size. The size completes it to a full model.
      series: /^Q[5-9]0[A-Z]$/,
      compose: function (size, series) { return "QN" + size + series; },
      words: /\b(?:tv|tvs|television|televisions)\b/i
    }),
    refrigerator: Object.freeze({
      // LG "LRFCS25D3S", "LRMVS3006S", "LFXS26973S", "LMXS28626S", "LSXS26366S", "LTCS24223S".
      model: /^L(?:R[A-Z]{1,3}|[FMST][A-Z]{1,3})\d{2,5}[A-Z0-9]{0,4}$/,
      series: null,
      compose: null,
      words: /\b(?:refrigerator|refrigerators|fridge|fridges)\b/i
    })
  });

  const TV_SIZE_MIN = 32;
  const TV_SIZE_MAX = 98;
  const TV_SIZE_CHOICES = Object.freeze([55, 65, 75]);
  const MAX_CHOICES = 3;
  const CANDIDATE_PATTERN = /^[A-Z0-9][A-Z0-9-]{2,39}$/;
  const SIZE_TOKEN = /^\d{2,3}(?:-?(?:IN|INCH|INCHES))?$/;
  const INTENT_PATTERN = /\b(?:replace|replaces|replacing|replacement|replacements|lkq|like[- ]kind|equivalent|substitute|upgrade|find|research|look\s*up)\b/i;
  const CANCEL_PATTERN = /^(?:cancel|never\s*mind|nevermind|start\s+over|reset|forget\s+it|stop)\b/i;

  const SCOPE_MESSAGE = "I can currently help identify and research replacement models. Send me a brand and model number, or use Find Replacement.";
  const ASK_ITEM_MESSAGE = "Which item should I research? Send a brand and model number, like Samsung QN55Q80C.";
  const MANUAL_LABEL = "Enter the details manually";

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function supportedCategories() {
    return Object.keys(RF.SUPPORT);
  }

  function describe(category) {
    return RF.SUPPORT[category].brand + " " + RF.SUPPORT[category].label.toLowerCase();
  }

  /* ---------- Pure parsing helpers ---------- */

  /** Collapses whitespace and control characters (the same cleaning validation uses) and straightens typographic quotes. */
  function normalizeText(text) {
    return RF.clean(typeof text === "string" ? text : "").replace(/[“”″]/g, '"').replace(/[‘’]/g, "'");
  }

  function tokenize(text) {
    return normalizeText(text).split(/[\s,;:!?()[\]]+/)
      .map(function (token) { return token.replace(/^[.'"-]+|[.'"-]+$/g, ""); })
      .filter(Boolean);
  }

  function unique(values) {
    return values.filter(function (value, index) { return values.indexOf(value) === index; });
  }

  /** Categories whose supported brand is named in the text ("Samsung" -> television, "LG" -> refrigerator). Never guesses other brands. */
  function detectBrand(text) {
    const normalized = normalizeText(text);
    return supportedCategories().filter(function (category) {
      return new RegExp("\\b" + escapeRegExp(RF.SUPPORT[category].brand) + "\\b", "i").test(normalized);
    });
  }

  /** Categories named by a plain word ("TV", "fridge"). */
  function detectCategoryWords(text) {
    const normalized = normalizeText(text);
    return supportedCategories().filter(function (category) {
      return FAMILIES[category] && FAMILIES[category].words.test(normalized);
    });
  }

  /** The supported category whose model pattern matches, or null. Brand is inferred from this only, never from an arbitrary string. */
  function inferCategory(model) {
    const value = String(model || "").toUpperCase();
    const found = supportedCategories().filter(function (category) { return FAMILIES[category] && FAMILIES[category].model.test(value); });
    return found.length === 1 ? found[0] : null;
  }

  function seriesCategory(token) {
    const found = supportedCategories().filter(function (category) { return FAMILIES[category] && FAMILIES[category].series && FAMILIES[category].series.test(token); });
    return found.length === 1 ? found[0] : null;
  }

  function isModelLike(token) {
    return CANDIDATE_PATTERN.test(token) && /[A-Z]/.test(token) && /\d/.test(token) && !SIZE_TOKEN.test(token);
  }

  /**
   * Model-looking tokens in the text: `full` match a supported family pattern, `series` are sizeless QLED series, `other` merely look
   * like a model number. The tokens are upper-cased and de-duplicated, in the order they were typed.
   */
  function detectModel(text) {
    const tokens = unique(tokenize(text).map(function (token) { return token.toUpperCase(); }));
    const full = [];
    const series = [];
    const other = [];
    tokens.forEach(function (token) {
      if (inferCategory(token)) full.push(token);
      else if (seriesCategory(token)) series.push(token);
      else if (isModelLike(token)) other.push(token);
    });
    return { full: full, series: series, other: other };
  }

  /** A TV size in inches: "55\"", "55 inch", "55-inch", "55in"; or a bare two-digit number when `allowBare` (a series or a size question). */
  function detectSize(text, allowBare) {
    const normalized = normalizeText(text);
    const unit = /(?:^|[^\dA-Za-z])(\d{2,3})\s*-?\s*(?:inch(?:es)?\b|in\b|")/i.exec(normalized);
    let size = unit ? Number(unit[1]) : null;
    if (size === null && allowBare) {
      const bare = tokenize(normalized).filter(function (token) { return /^\d{2,3}$/.test(token); });
      if (bare.length === 1) size = Number(bare[0]);
    }
    return size !== null && size >= TV_SIZE_MIN && size <= TV_SIZE_MAX ? size : null;
  }

  // The notes the lookup form already invites ("Must fit existing opening, reusing wall mount"). Anything else stays out of the request.
  const NOTE_RULES = Object.freeze([
    {
      note: "Must fit existing opening",
      pattern: /\bfit(?:s|ting)?\b[^.;]{0,30}\b(?:same|existing|current|original)\s+(?:opening|cutout)\b/i
    },
    {
      note: "Reusing existing wall mount",
      pattern: /\b(?:reus(?:e|ing)|re-use|re-using|keep(?:ing)?|us(?:e|ing)|same|existing|current)\b[^.;]{0,30}\bwall[\s-]?mount\b/i
    }
  ]);
  const NEGATION = /\b(?:not|no|never|without|cannot|cant|dont|wont|isnt|doesnt)\b|n['’]t\b/i;

  /** Canonical notes for the installation constraints stated in the text, in a fixed order. A negated constraint is not a note. */
  function extractSupportedNotes(text) {
    const normalized = normalizeText(text);
    return NOTE_RULES.filter(function (rule) {
      const match = rule.pattern.exec(normalized);
      if (!match) return false;
      return !NEGATION.test(normalized.slice(Math.max(0, match.index - 20), match.index + match[0].length));
    }).map(function (rule) { return rule.note; });
  }

  /* ---------- Draft and resolution ---------- */

  /** What one message says, before it is merged with anything said earlier. */
  function interpret(text, options) {
    const found = detectModel(text);
    const brands = detectBrand(text);
    const words = detectCategoryWords(text);
    const explicit = unique(brands.concat(words));
    const hasSeries = found.series.length > 0;
    return {
      explicit: explicit,
      full: found.full,
      series: found.series,
      other: found.other,
      size: detectSize(text, hasSeries || Boolean(options && options.expectSize)),
      notes: extractSupportedNotes(text),
      hasIntent: INTENT_PATTERN.test(normalizeText(text))
    };
  }

  function emptyDraft() {
    return Object.freeze({ explicit: [], candidates: [], series: [], size: null, notes: [], confirmed: false, conflictResolved: false });
  }

  /** Merges a new message into the draft. A newly named model replaces the old one; notes accumulate; nothing is mutated. */
  function mergeDraft(prior, said) {
    const base = prior || emptyDraft();
    const namedModel = said.full.length > 0 || said.series.length > 0 || said.other.length > 0;
    const candidates = said.full.length ? said.full : (said.series.length ? [] : said.other);
    return Object.freeze({
      explicit: said.explicit.length ? said.explicit : base.explicit,
      candidates: namedModel ? candidates : base.candidates,
      series: said.full.length ? [] : (said.series.length ? said.series : (namedModel ? [] : base.series)),
      size: said.size !== null ? said.size : base.size,
      notes: unique(base.notes.concat(said.notes)),
      confirmed: namedModel ? false : base.confirmed,
      conflictResolved: namedModel || said.explicit.length ? false : base.conflictResolved
    });
  }

  /** Which of brand/category, model and size are still needed before a lookup can run. */
  function determineMissingFields(draft) {
    const missing = [];
    const category = draft.explicit.length === 1 ? draft.explicit[0] : null;
    const series = draft.series;
    const implied = series.length ? seriesCategory(series[0]) : (draft.candidates.length === 1 ? inferCategory(draft.candidates[0]) : null);
    if (!category && !implied) missing.push("category");
    if (!draft.candidates.length && !series.length) missing.push("model");
    else if (series.length && draft.size === null && !draft.candidates.length) missing.push("size");
    return missing;
  }

  function sizeChoices() {
    return TV_SIZE_CHOICES.map(function (size) { return { label: size + '"', value: { kind: "size", size: size } }; })
      .concat([{ label: "Other", value: { kind: "manual" } }]);
  }

  function manualChoice() {
    return { label: MANUAL_LABEL, value: { kind: "manual" } };
  }

  function categoryChoices() {
    return supportedCategories().map(function (category) { return { label: describe(category), value: { kind: "category", category: category } }; });
  }

  function modelChoices(models) {
    return models.slice(0, MAX_CHOICES).map(function (model) { return { label: model, value: { kind: "model", model: model } }; }).concat([manualChoice()]);
  }

  /** The follow-up question for the first thing still missing, with compact choices where they make sense. */
  function buildClarification(draft, field) {
    const category = draft.explicit.length === 1 ? draft.explicit[0] : null;
    if (field === "size") return { field: "size", prompt: "What size is the TV?", choices: sizeChoices() };
    if (field === "model") {
      const subject = category ? "the " + describe(category) : "the item";
      return { field: "model", prompt: "What is the model number of " + subject + "?", choices: [manualChoice()] };
    }
    return { field: "category", prompt: "Is this a Samsung television or an LG refrigerator?", choices: categoryChoices().concat([manualChoice()]) };
  }

  function buildPayload(category, model, notes) {
    const checked = RF.validateLookup({ category: category, brand: RF.SUPPORT[category].brand, model: model, notes: notes.join("; "), website: "" });
    return checked.ok ? checked.value : null;
  }

  function manualAction(message, draft, category, model) {
    return { type: "manual", message: message, prefill: { category: category || undefined, model: model || "", notes: draft ? draft.notes.join("; ") : "" } };
  }

  function acknowledge(payload, composed) {
    const lead = (composed ? "I read that as " : "I found ") + payload.brand + " " + payload.model + ". Researching the current replacement now.";
    return payload.notes ? lead + " I'll note: " + payload.notes + "." : lead;
  }

  function clarifyAction(draft, clarification) {
    return { type: "clarify", field: clarification.field, prompt: clarification.prompt, choices: clarification.choices, draft: draft };
  }

  /**
   * Decides what a draft needs next: { action, status }. Never produces a model the user did not state (apart from the documented
   * Samsung size + series composition), and routes anything uncertain to a question or to the manual form instead of guessing.
   */
  function resolve(draft) {
    const explicit = draft.explicit;
    const series = draft.series;
    const candidates = draft.candidates;
    const categoryChoicesWithManual = categoryChoices().concat([manualChoice()]);

    if (explicit.length > 1) {
      return clarifying(draft, { field: "category", prompt: "I can research one item at a time. Which is it?", choices: categoryChoicesWithManual });
    }
    if (series.length > 1 || candidates.length > 1) {
      return clarifying(draft, { field: "model", prompt: "Which one is the model number?", choices: modelChoices(series.length > 1 ? series : candidates) });
    }

    const model = candidates[0] || null;
    const impliedCategory = model ? inferCategory(model) : (series.length ? seriesCategory(series[0]) : null);
    if (explicit[0] && impliedCategory && explicit[0] !== impliedCategory && !draft.conflictResolved) {
      const prompt = (model || series[0]) + " looks like a " + describe(impliedCategory) + " model, which doesn't match what you said. Which is right?";
      return clarifying(draft, { field: "category", prompt: prompt, choices: categoryChoicesWithManual });
    }

    const missing = determineMissingFields(draft);
    if (missing.indexOf("category") !== -1) {
      if (!model) return { status: STATUS.IDLE, action: { type: "say", message: SCOPE_MESSAGE } };
      const message = "I can currently research Samsung televisions and LG refrigerators, and I don't recognize " + model + " as either.";
      return { status: STATUS.IDLE, action: manualAction(message, draft, null, model) };
    }
    if (missing[0] === "model" || missing[0] === "size") return clarifying(draft, buildClarification(draft, missing[0]));

    const category = explicit[0] || impliedCategory;
    if (!model) return ready(draft, category, FAMILIES[category].compose(draft.size, series[0]), true);
    if (impliedCategory === category || draft.confirmed) return ready(draft, category, model, false);

    const prompt = "I don't recognize " + model + " as a " + describe(category) + " model number. I can still check it, or you can enter the details yourself.";
    return clarifying(draft, { field: "confirm", prompt: prompt, choices: [{ label: "Research " + model + " anyway", value: { kind: "confirm" } }, manualChoice()] });
  }

  function clarifying(draft, clarification) {
    return { status: STATUS.NEEDS_CLARIFICATION, action: clarifyAction(draft, clarification) };
  }

  function ready(draft, category, model, composed) {
    const payload = buildPayload(category, model, draft.notes);
    if (!payload) return { status: STATUS.IDLE, action: manualAction("That doesn't look like a valid model number. Check the details and run the lookup.", draft, category, model) };
    return { status: STATUS.READY, action: { type: "lookup", payload: payload, composed: composed, message: acknowledge(payload, composed) } };
  }

  function settle(state, outcome, draft) {
    const parsed = moveTo(state, STATUS.PARSED);
    const next = moveTo(parsed, outcome.status, { draft: outcome.status === STATUS.IDLE ? null : draft, pending: outcome.status === STATUS.NEEDS_CLARIFICATION ? outcome.action : null });
    return { state: next, action: outcome.action };
  }

  /* ---------- Events ---------- */

  /**
   * A typed message. Returns { state, action }, where action is one of
   *   { type: "lookup", payload, message }          run the existing lookup (message is the acknowledgement)
   *   { type: "clarify", prompt, choices }          ask one short question
   *   { type: "manual", message, prefill }          offer the structured form, prefilled with what is known
   *   { type: "say", message }                      reply only (no lookup, no form)
   */
  function receive(state, text) {
    const normalized = normalizeText(text);
    const waiting = state.status === STATUS.NEEDS_CLARIFICATION;
    if (CANCEL_PATTERN.test(normalized) && (waiting || normalized.split(" ").length === 1)) {
      return { state: moveTo(state, STATUS.IDLE, { draft: null, pending: null }), action: { type: "say", message: "No problem. Send a brand and model number whenever you're ready." } };
    }

    const said = interpret(normalized, { expectSize: waiting && state.pending && state.pending.field === "size" });
    const understood = said.explicit.length || said.full.length || said.series.length || said.other.length || said.notes.length || said.size !== null;
    const prior = waiting ? state.draft : null;

    if (!understood) {
      if (waiting) return { state: state, action: Object.assign({}, state.pending, { prompt: "I didn't catch that. " + state.pending.prompt }) };
      const message = said.hasIntent ? ASK_ITEM_MESSAGE : SCOPE_MESSAGE;
      return { state: moveTo(state, STATUS.IDLE, { draft: null, pending: null }), action: { type: "say", message: message } };
    }

    const draft = mergeDraft(prior, said);
    return settle(state, resolve(draft), draft);
  }

  /** The user settled a conflict by naming the category. A sizeless series that belongs to another category is dropped, never reinterpreted. */
  function chooseCategory(draft, category) {
    const keepSeries = draft.series.filter(function (series) { return seriesCategory(series) === category; });
    return Object.freeze(Object.assign({}, draft, { explicit: [category], series: keepSeries, confirmed: false, conflictResolved: true }));
  }

  /** A tapped choice from a clarification card. Same result shape as receive(). */
  function answer(state, value) {
    if (state.status !== STATUS.NEEDS_CLARIFICATION || !value || !state.draft) return { state: state, action: null };
    const draft = state.draft;
    if (value.kind === "manual") {
      const category = draft.explicit.length === 1 ? draft.explicit[0] : null;
      const model = draft.candidates.length === 1 ? draft.candidates[0] : "";
      return { state: moveTo(state, STATUS.IDLE, { draft: null, pending: null }), action: manualAction("Sure. Check the details and run the lookup.", draft, category, model) };
    }
    let next = draft;
    if (value.kind === "size" && Number.isInteger(value.size)) next = Object.freeze(Object.assign({}, draft, { size: value.size }));
    else if (value.kind === "category" && RF.SUPPORT[value.category]) next = chooseCategory(draft, value.category);
    else if (value.kind === "model" && typeof value.model === "string") next = Object.freeze(Object.assign({}, draft, { candidates: [value.model], series: [] }));
    else if (value.kind === "confirm") next = Object.freeze(Object.assign({}, draft, { confirmed: true }));
    else return { state: state, action: null };
    return settle(moveTo(state, STATUS.IDLE, { pending: null }), resolve(next), next);
  }

  function markResearching(state) { return moveTo(state, STATUS.RESEARCHING, { draft: null, pending: null }); }
  function markResult(state) { return moveTo(state, STATUS.RESULT); }
  function markError(state) { return moveTo(state, STATUS.ERROR); }
  function reset() { return initialState(); }

  const api = {
    STATUS: STATUS, TRANSITIONS: TRANSITIONS, SCOPE_MESSAGE: SCOPE_MESSAGE, ASK_ITEM_MESSAGE: ASK_ITEM_MESSAGE, MANUAL_LABEL: MANUAL_LABEL, FAMILIES: FAMILIES,
    TV_SIZE_CHOICES: TV_SIZE_CHOICES,
    canTransition: canTransition, initialState: initialState, normalizeText: normalizeText, detectBrand: detectBrand, detectCategoryWords: detectCategoryWords,
    inferCategory: inferCategory, detectModel: detectModel, detectSize: detectSize, extractSupportedNotes: extractSupportedNotes,
    determineMissingFields: determineMissingFields, buildClarification: buildClarification, acknowledge: acknowledge,
    receive: receive, answer: answer, markResearching: markResearching, markResult: markResult, markError: markError, reset: reset
  };

  if (typeof module === "object" && module.exports) module.exports = api;
  else root.RFIntake = api;
})(typeof window !== "undefined" ? window : this);
