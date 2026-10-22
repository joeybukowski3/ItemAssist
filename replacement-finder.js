/*
 * ItemAssist workspace controller: wires the assistant pane to the Product Intelligence pane and owns the request state.
 * The only network call is a same-origin POST to /api/replacement-finder (and a GET for availability). There is no scoring,
 * matching or LKQ logic here; the report is whatever the public contract says.
 */
(function () {
  "use strict";

  var RF = window.RFShared;
  var Intake = window.RFIntake;
  var D = window.RFDom;
  // ItemAssist Research (additive): present only if its modules loaded. Without them the page is exactly the classic lookup.
  var RS = window.RFResearch;
  var RV = window.RFResearchView;
  var API_URL = "/api/replacement-finder";
  var RESEARCH_URL = "/api/itemassist-research";
  var RESEARCH_TIMEOUT_MS = 15000;
  var CLIENT_TIMEOUT_MS = 30000;
  var STAGE_INTERVAL_MS = 3500;
  // Below this width the assistant and the report share one continuous page; above it they sit side by side.
  // Keep in step with the max-width: 960px rules in replacement-finder.css and assets/css/rf-product.css.
  var NARROW_QUERY = "(max-width: 960px)";

  var productRoot = document.getElementById("rf-product-root");
  var narrowQuery = window.matchMedia(NARROW_QUERY);

  var state = { controller: null, stageTimer: null, run: 0, report: null, last: null, enabled: true, intake: Intake.initialState(), exchangeStart: null };

  function localStorageOrNull() {
    try { return window.localStorage; } catch (error) { return null; }
  }
  // Research is OFF until the research route reports itself enabled; `session` is the in-memory conversation about the current item.
  var research = RS && RV
    ? { enabled: false, session: RS.initialSession(), view: null, greeting: null, visitorId: RS.createVisitorId(localStorageOrNull()) }
    : { enabled: false, view: null };

  var UNAVAILABLE_ON_ITS_OWN = {
    explain: ["Why this match?", "Run Find Replacement first and I can explain why a model was chosen."],
    verify: ["Verify Specs", "Verifying specifications on their own isn't available yet. Run Find Replacement and the report shows each original specification and how it was verified."],
    compare: ["Compare Models", "Comparing arbitrary models isn't available yet. Find Replacement compares the original with its best current replacement."],
    price: ["Price Item", "Standalone pricing isn't available yet. When Find Replacement returns a replacement, its observed retail price appears in the Pricing tab."]
  };
  var REPORT_ACTIONS = {
    verify: { label: "Verify specifications", tab: "specs", reply: "Showing the original specifications and how each one was verified." },
    compare: { label: "Compare the original to the replacement", tab: "replacement", reply: "Showing the specification comparison for the original and its replacement." },
    price: { label: "Price this item", tab: "pricing", reply: "Showing the observed retail price and where it came from." },
    explain: { label: "Why is this the best match?", tab: "overview", reply: "Here is why this result was chosen, and what remains unverified." }
  };

  function isNarrow() {
    return narrowQuery.matches;
  }

  function prefersReducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  /* ---------- Product pane ---------- */

  /** Brings the product identity into view and focuses it: the top of the page beside the assistant, or the "Product Intelligence" divider and identity on the single page. */
  function focusIdentity() {
    if (!state.report) return;
    var behavior = prefersReducedMotion() ? "auto" : "smooth";
    if (isNarrow()) state.report.header.scrollIntoView({ block: "start", behavior: behavior });
    else window.scrollTo({ top: 0, behavior: behavior });
    state.report.nameHeading.focus({ preventScroll: true });
  }

  function showProduct(node) {
    productRoot.replaceChildren(node);
  }

  function showReport() {
    if (state.report) showProduct(state.report.node);
    else showProduct(window.RFProduct.renderEmpty());
  }

  /* ---------- Assistant ---------- */

  var assistant = window.RFAssistant.create({
    log: document.getElementById("rf-log"),
    quick: document.getElementById("rf-quick"),
    form: document.getElementById("rf-composer"),
    input: document.getElementById("rf-compose-input"),
    unavailable: document.getElementById("rf-unavailable"),
    toggle: document.getElementById("rf-convo-toggle")
  }, { onLookup: lookup, onQuick: onQuick, onFreeText: onFreeText, onCancelLoading: cancelLoading, isNarrow: isNarrow });

  /**
   * A typed message goes through the deterministic intake (RFIntake): a confident brand/model starts the existing lookup directly,
   * a gap becomes one short question, and anything else gets the scope message. No form opens unless the user needs the manual path.
   * The conversational parse is a convenience; the proxy still validates every request and its answer wins.
   */
  function onFreeText(text) {
    if (research.enabled) return researchText(text);
    var message = assistant.userSays(text);
    if (!state.enabled) return assistant.say("Replacement Finder isn't available right now. Please check back soon.");
    if (state.intake.status !== Intake.STATUS.NEEDS_CLARIFICATION) state.exchangeStart = message;
    assistant.clearChoices();
    applyIntake(Intake.receive(state.intake, text));
  }

  function onChoice(value) {
    if (!state.enabled) return;
    applyIntake(Intake.answer(state.intake, value));
  }

  function applyIntake(result) {
    state.intake = result.state;
    var action = result.action;
    if (!action) return;
    if (action.type === "lookup") {
      assistant.say(action.message);
      return lookup(action.payload, { after: state.exchangeStart });
    }
    if (action.type === "clarify") return assistant.askChoice(action.prompt, action.choices, onChoice);
    if (action.type === "manual") {
      assistant.say(action.message);
      return assistant.openPrompt(action.prefill);
    }
    assistant.say(action.message);
  }

  function onQuick(action, notReady) {
    if (action === "research-new") {
      assistant.userSays("New research");
      return resetResearch();
    }
    if (action === "find") {
      if (!state.enabled) return assistant.say("Replacement Finder isn't available right now. Please check back soon.");
      state.intake = Intake.reset();
      assistant.clearChoices();
      return assistant.openPrompt(state.last || {});
    }
    if (notReady || !state.report) {
      var pending = UNAVAILABLE_ON_ITS_OWN[action];
      assistant.userSays(pending[0]);
      return assistant.say(pending[1]);
    }
    var step = REPORT_ACTIONS[action];
    assistant.userSays(step.label);
    var data = state.report.data;
    if (!data.primary && action !== "verify") return assistant.say("No replacement was confirmed for this lookup, so there is nothing to " + (action === "price" ? "price" : action === "compare" ? "compare" : "explain") + ".");
    assistant.say(step.reply);
    // Beside the assistant this switches tab; on the single page it scrolls to that section. Either way focus lands there.
    state.report.reveal(step.tab, action === "explain" ? "#rf-why-h" : null);
  }

  /* ---------- Request ---------- */

  function stopLoading() {
    if (state.stageTimer) window.clearInterval(state.stageTimer);
    state.stageTimer = null;
    state.controller = null;
    assistant.setBusy(false);
  }

  function cancelLoading() {
    state.run += 1;
    if (state.controller) state.controller.abort();
    state.intake = Intake.reset();
    stopLoading();
    markLoadingDone();
    showReport();
    assistant.say("Lookup cancelled. Nothing was changed.");
    assistant.focusComposer();
  }

  function markLoadingDone() {
    var loading = document.querySelector(".rf-msg--loading");
    if (loading) loading.remove();
  }

  function startLoading(model) {
    var loading = assistant.showLoading(model);
    var step = 0;
    showProduct(window.RFProduct.renderResearching(model));
    state.stageTimer = window.setInterval(function () {
      if (step < loading.stageCount - 1) { step += 1; loading.setStep(step); }
    }, STAGE_INTERVAL_MS);
  }

  /** `source.after` is the user's own message when the lookup came from the conversation (it is not echoed a second time). */
  async function lookup(payload, source) {
    var run = ++state.run;
    state.intake = Intake.markResearching(state.intake);
    var controller = new AbortController();
    state.controller = controller;
    state.last = { category: payload.category, model: payload.model, notes: payload.notes };
    // A new lookup replaces the previous report: showing model A's report beside model B's conversation would mislead.
    state.report = null;
    if (research.view) { research.view = null; syncQuick(false); }
    assistant.setReportReady(false);
    assistant.commitPrompt(payload, source);
    assistant.setBusy(true);
    startLoading(payload.brand + " " + payload.model);
    var timeout = window.setTimeout(function () { controller.abort(); }, CLIENT_TIMEOUT_MS);
    var outcome;
    try {
      var response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
        credentials: "same-origin"
      });
      var parsed = null;
      try { parsed = await response.json(); } catch (error) { parsed = null; }
      outcome = { body: parsed };
    } catch (error) {
      outcome = { network: true, aborted: controller.signal.aborted };
    } finally {
      window.clearTimeout(timeout);
    }
    if (run !== state.run) return; // cancelled or superseded
    stopLoading();
    markLoadingDone();
    if (outcome.network) return fail(outcome.aborted ? "ENGINE_TIMEOUT" : "NETWORK_ERROR");
    renderResponse(outcome.body, payload);
  }

  /* ---------- Outcomes ---------- */

  function fail(code) {
    state.intake = Intake.markError(state.intake);
    showReport();
    var again = D.button("Try again", "rf-secondary", function () { assistant.openPrompt(state.last || {}); });
    var node = assistant.say([D.h("p", { text: RF.errorMessage(code) }), D.h("div", { class: "rf-actions" }, [again])], "rf-msg--error");
    node.setAttribute("role", "alert");
    assistant.moveFocusTo(node);
  }

  function unsupported(payload) {
    state.intake = Intake.markResult(state.intake);
    showReport();
    var options = Object.keys(RF.SUPPORT).map(function (key) {
      return D.h("li", {}, [D.button(RF.SUPPORT[key].noun, "rf-support-option", function () { assistant.openPrompt({ category: key }); })]);
    });
    var message = assistant.say([
      D.h("p", {}, ["I couldn't match ", D.h("span", { class: "rf-mono", text: payload.model }), " to a product Replacement Finder covers today."]),
      D.h("p", { text: "Replacement Finder currently supports:" }),
      D.h("ul", { class: "rf-support-list" }, options)
    ]);
    assistant.moveFocusTo(message);
  }

  function summaryLine(data) {
    var retail = data.primary && data.primary.retail;
    if (!retail) return null;
    var price = RF.formatPrice(retail.observedPrice);
    var observed = RF.formatObservedDate(retail.observedAt);
    return ["New", "Available", retail.sourceName || retail.sourceDomain, price, observed ? "observed " + observed : null].filter(Boolean).join(" · ");
  }

  function announceReport(data) {
    var head = RF.headlineFor(data);
    var open = D.button("View product intelligence", "rf-secondary rf-view-product", focusIdentity);
    var body = [D.h("p", { class: "rf-msg-kicker", text: head.title })];
    if (data.primary) {
      body.push(D.h("p", { class: "rf-msg-name rf-mono", text: data.primary.displayName }));
      if (summaryLine(data)) body.push(D.h("p", { class: "rf-msg-line", text: summaryLine(data) }));
    } else {
      body.push(D.h("p", { text: "Nothing was confirmed for " + data.original.displayName + ". The product profile and evidence are still available." }));
    }
    if (RF.hasNoConfirmedLkq(data)) body.push(D.h("p", { class: "rf-msg-line", text: "No Confirmed LKQ" }));
    body.push(D.h("div", { class: "rf-actions" }, [open]));
    var tone = head.key === "BEST_AVAILABLE" ? "best" : data.primary ? "ok" : "none";
    return assistant.say(body, "rf-msg--summary rf-msg--summary-" + tone);
  }

  function renderResponse(body, payload) {
    var known = body && typeof body === "object";
    if (known && body.status === "UNSUPPORTED") return unsupported(payload);
    if (known && body.status === "ERROR") return fail(body.errorCode);
    if (!(known && RF.STATUSES.indexOf(body.status) !== -1 && body.original && Array.isArray(body.comparison))) return fail("ENGINE_ERROR");
    try {
      state.report = Object.assign(window.RFProduct.renderReport(body, { isNarrow: isNarrow }), { data: body });
    } catch (error) {
      // A 200 that passed the shallow shape check but is not a usable contract is an engine error, never a half-built report.
      state.report = null;
      return fail("ENGINE_ERROR");
    }
    state.intake = Intake.markResult(state.intake);
    showReport();
    assistant.setReportReady(true);
    // On the single page the finished lookup leaves one compact summary in the conversation; the rest is a tap away.
    assistant.foldBefore(announceReport(body));
    focusIdentity();
  }

  /* ---------- ItemAssist Research (the default workflow while the research route is enabled) ---------- */

  /** Shows the Product Intelligence pane for research (true) or anything else (false); the v1 report actions only apply to a v1 report. */
  function syncQuick(isResearchView) {
    document.getElementById("rf-assistant").classList.toggle("rf-view-research", Boolean(isResearchView));
  }

  function showResearchOrEmpty() {
    if (research.view) {
      showProduct(research.view.node);
      syncQuick(true);
    } else {
      showProduct(window.RFProduct.renderEmpty());
      syncQuick(false);
    }
  }

  function focusResearch() {
    if (!research.view) return;
    var behavior = prefersReducedMotion() ? "auto" : "smooth";
    if (isNarrow()) research.view.header.scrollIntoView({ block: "start", behavior: behavior });
    else window.scrollTo({ top: 0, behavior: behavior });
    research.view.nameHeading.focus({ preventScroll: true });
  }

  function resetResearch() {
    research.session = RS.initialSession();
    research.view = null;
    // The fine print describes the report on screen; with no report it returns to the standard wording.
    var fineprint = document.querySelector(".rf-fineprint");
    if (fineprint) fineprint.textContent = RS.FINEPRINT;
    showResearchOrEmpty();
    assistant.say(RS.STARTING_FRESH);
    assistant.focusComposer();
  }

  /**
   * A typed message in research mode. What it means (a new item, more detail on this one, a question about the results, or unclear)
   * is decided locally by RFResearch.classify, so only a new item or added detail ever costs a research request.
   */
  function researchText(text) {
    var verdict = RS.classify(research.session, text);
    if (verdict.kind === "empty") return;
    assistant.userSays(text);
    assistant.clearChoices();
    if (verdict.kind === "reset") return resetResearch();
    if (verdict.kind === "question") {
      var answer = RS.localAnswer(research.session, text);
      return assistant.say(answer ? answer.map(function (line) { return D.h("p", { text: line }); }) : RS.FALLBACK_HELP);
    }
    if (verdict.kind === "ask") {
      return assistant.askChoice(RS.ASK_WHICH, [{ label: "More detail on this item", value: "refine" }, { label: "A different item", value: "new" }], function (mode) {
        submitResearch(mode, verdict.text);
      });
    }
    submitResearch(verdict.kind, verdict.text);
  }

  function submitResearch(mode, text) {
    var composed = RS.composeQuery(research.session, text, mode);
    if (!composed) return assistant.say(RS.TOO_LONG);
    runResearch(mode, text, composed);
  }

  function cancelResearch() {
    state.run += 1;
    if (state.controller) state.controller.abort();
    stopLoading();
    markLoadingDone();
    showResearchOrEmpty();
    assistant.say("Research cancelled. Nothing was changed.");
    assistant.focusComposer();
  }

  async function runResearch(mode, text, composed) {
    var run = ++state.run;
    var controller = new AbortController();
    state.controller = controller;
    assistant.setBusy(true);
    var loading = assistant.say([
      D.h("p", { text: "Researching " + composed.query + "..." }),
      D.h("div", { class: "rf-actions" }, [D.button("Cancel", "rf-secondary", cancelResearch)])
    ], "rf-msg--loading");
    loading.setAttribute("role", "status");
    showProduct(RV.renderResearching(composed.query));
    syncQuick(false);
    var timeout = window.setTimeout(function () { controller.abort(); }, RESEARCH_TIMEOUT_MS);
    var outcome;
    try {
      var headers = { "Content-Type": "application/json", Accept: "application/json" };
      var visitor = research.visitorId();
      if (visitor) headers["X-Visitor-Id"] = visitor;
      var response = await fetch(RESEARCH_URL, {
        method: "POST", headers: headers, body: JSON.stringify({ query: composed.query, website: "" }), signal: controller.signal, credentials: "same-origin"
      });
      var parsed = null;
      try { parsed = await response.json(); } catch (error) { parsed = null; }
      outcome = { body: parsed };
    } catch (error) {
      outcome = { network: true, aborted: controller.signal.aborted };
    } finally {
      window.clearTimeout(timeout);
    }
    if (run !== state.run) return; // cancelled or superseded
    stopLoading();
    markLoadingDone();
    if (outcome.network) return researchFail(outcome.aborted ? "ENGINE_TIMEOUT" : "NETWORK_ERROR");
    renderResearch(outcome.body, mode, text, composed);
  }

  /** Every failure is a short message from fixed copy. The classic lookup is offered when it is a sensible alternative. */
  function researchFail(code) {
    showResearchOrEmpty();
    var children = [D.h("p", { text: RS.errorMessage(code) })];
    if (RS.offersClassic(code)) {
      children.push(D.h("div", { class: "rf-actions" }, [D.button("Use classic lookup", "rf-secondary", function () { assistant.openPrompt(state.last || {}); })]));
    }
    var node = assistant.say(children, "rf-msg--error");
    node.setAttribute("role", "alert");
    assistant.moveFocusTo(node);
  }

  /** The assistant's reply: the headline, a few plain lines, the questions to answer next, and what is left of today's allowance. */
  function researchSummary(data) {
    var reply = RS.reply(data, data.quota);
    var body = [D.h("p", { class: "rf-msg-kicker", text: reply.kicker })];
    reply.lines.forEach(function (line) { body.push(D.h("p", { text: line })); });
    if (reply.questions.length) {
      body.push(D.h("p", { class: "rf-msg-note-q", text: reply.questions.length === 1 ? "To tighten this up:" : "To tighten this up, tell me:" }));
      body.push(D.h("ul", { class: "rf-rs-questions" }, reply.questions.map(function (question) { return D.h("li", { text: question }); })));
    }
    if (reply.quotaLine) body.push(D.h("p", { class: "rf-msg-line", text: reply.quotaLine }));
    body.push(D.h("div", { class: "rf-actions" }, [D.button("View product intelligence", "rf-secondary rf-view-product", focusResearch)]));
    return assistant.say(body, "rf-msg--summary rf-msg--summary-" + reply.tone);
  }

  function renderResearch(body, mode, text, composed) {
    if (body && typeof body === "object" && body.status === "ERROR") return researchFail(body.errorCode);
    if (!RS.isResearchResponse(body)) return researchFail("ENGINE_ERROR");
    var view;
    try {
      view = RV.renderReport(body, { isNarrow: isNarrow });
    } catch (error) {
      // A 200 that passed the shape check but cannot be rendered is an engine error, never a half-built report.
      return researchFail("ENGINE_ERROR");
    }
    research.session = RS.adopt(research.session, mode, text, composed, body);
    research.view = view;
    var fineprint = document.querySelector(".rf-fineprint");
    if (fineprint) fineprint.textContent = RS.isV2(body) ? RS.FINEPRINT_V2 : RS.FINEPRINT;
    state.report = null;
    assistant.setReportReady(false);
    showResearchOrEmpty();
    assistant.foldBefore(researchSummary(body));
    // Beside the report the conversation continues in the composer; on the single page the finished report starts directly below.
    if (isNarrow()) focusResearch(); else assistant.focusComposer();
  }

  /** Turns the workspace into the research experience: same two panes and composer, new greeting, placeholder and a "New research" action. */
  function enableResearch() {
    research.enabled = true;
    document.getElementById("rf-assistant").classList.add("rf-mode-research");
    var input = document.getElementById("rf-compose-input");
    input.placeholder = RS.PLACEHOLDER;
    input.maxLength = RS.MAX_QUERY_CHARS;
    var fineprint = document.querySelector(".rf-fineprint");
    if (fineprint) fineprint.textContent = RS.FINEPRINT;
    var greeting = research.greeting && research.greeting.querySelector(".rf-msg-body p");
    if (greeting && !document.querySelector(".rf-msg--user")) greeting.textContent = RS.GREETING;
    var classic = document.querySelector('[data-action="find"]');
    if (classic) { classic.textContent = "Classic lookup"; classic.classList.remove("rf-qa--primary"); }
    var chip = D.h("li", {}, [D.h("button", { class: "rf-qa rf-qa--primary", text: "New research", attrs: { type: "button", "data-action": "research-new" } })]);
    document.getElementById("rf-quick").insertBefore(chip, document.getElementById("rf-quick").firstChild);
  }

  async function checkResearch() {
    if (!RS || !RV) return;
    if (new URLSearchParams(window.location.search).get("research") === "0") return; // an explicit way to use the classic lookup only
    try {
      var response = await fetch(RESEARCH_URL, { method: "GET", headers: { Accept: "application/json" }, credentials: "same-origin" });
      var body = await response.json();
      if (body && body.enabled === true) enableResearch();
    } catch (error) { /* the classic lookup stays; research availability is a courtesy check */ }
  }

  /* ---------- Init ---------- */

  async function checkAvailability() {
    try {
      var response = await fetch(API_URL, { method: "GET", headers: { Accept: "application/json" }, credentials: "same-origin" });
      var body = await response.json();
      if (body && body.enabled === false) { state.enabled = false; assistant.setAvailability(false); }
    } catch (error) { /* availability is a courtesy; a real request reports its own errors */ }
  }

  /** Crossing the breakpoint (rotation, window resize) switches an open report between tabs and jump links in place. */
  function watchLayout() {
    var syncMode = function () {
      if (state.report) state.report.syncMode();
      if (research.view) research.view.syncMode();
    };
    if (narrowQuery.addEventListener) narrowQuery.addEventListener("change", syncMode); else narrowQuery.addListener(syncMode);
    var queued = false;
    window.addEventListener("scroll", function () {
      if (queued || !state.report || !isNarrow()) return;
      queued = true;
      window.requestAnimationFrame(function () {
        queued = false;
        if (state.report && isNarrow()) state.report.syncFromScroll();
      });
    }, { passive: true });
  }

  function init() {
    showProduct(window.RFProduct.renderEmpty());
    assistant.setReportReady(false);
    research.greeting = assistant.say("Tell me what item you're researching. You can start with a brand and model number.");
    watchLayout();
    checkAvailability();
    checkResearch();
  }

  init();
})();
