/*
 * ItemAssist workspace controller: wires the assistant pane to the Product Intelligence pane and owns the request state.
 * The only network call is a same-origin POST to /api/replacement-finder (and a GET for availability). There is no scoring,
 * matching or LKQ logic here; the report is whatever the public contract says.
 */
(function () {
  "use strict";

  var RF = window.RFShared;
  var D = window.RFDom;
  var API_URL = "/api/replacement-finder";
  var CLIENT_TIMEOUT_MS = 30000;
  var STAGE_INTERVAL_MS = 3500;
  // Below this width the assistant and the report share one continuous page; above it they sit side by side.
  // Keep in step with the max-width: 960px rules in replacement-finder.css and assets/css/rf-product.css.
  var NARROW_QUERY = "(max-width: 960px)";

  var productRoot = document.getElementById("rf-product-root");
  var narrowQuery = window.matchMedia(NARROW_QUERY);

  var state = { controller: null, stageTimer: null, run: 0, report: null, last: null, enabled: true };

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

  /** Input convenience only: recognises "<supported brand> <model>" so the structured prompt can be prefilled. Validation stays authoritative. */
  function parseEntry(text) {
    var lower = text.toLowerCase();
    var keys = Object.keys(RF.SUPPORT);
    for (var i = 0; i < keys.length; i += 1) {
      var brand = RF.SUPPORT[keys[i]].brand.toLowerCase();
      if (lower.indexOf(brand + " ") === 0) return { category: keys[i], model: text.slice(brand.length).trim() };
    }
    return null;
  }

  function onFreeText(text) {
    assistant.userSays(text);
    if (!state.enabled) return assistant.say("Replacement Finder isn't available right now. Please check back soon.");
    var entry = parseEntry(text);
    if (entry) {
      assistant.say("I can't hold a free-form conversation yet, but I can research that model. Check the details and run the lookup.");
      assistant.openPrompt(entry);
      return;
    }
    assistant.say("I can't answer free-form questions yet. I can run a replacement lookup. Enter the item details below.");
    assistant.openPrompt({});
  }

  function onQuick(action, notReady) {
    if (action === "find") {
      if (!state.enabled) return assistant.say("Replacement Finder isn't available right now. Please check back soon.");
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

  async function lookup(payload) {
    var run = ++state.run;
    var controller = new AbortController();
    state.controller = controller;
    state.last = { category: payload.category, model: payload.model, notes: payload.notes };
    // A new lookup replaces the previous report: showing model A's report beside model B's conversation would mislead.
    state.report = null;
    assistant.setReportReady(false);
    assistant.commitPrompt(payload);
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
    showReport();
    var again = D.button("Try again", "rf-secondary", function () { assistant.openPrompt(state.last || {}); });
    var node = assistant.say([D.h("p", { text: RF.errorMessage(code) }), D.h("div", { class: "rf-actions" }, [again])], "rf-msg--error");
    node.setAttribute("role", "alert");
    assistant.moveFocusTo(node);
  }

  function unsupported(payload) {
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
    showReport();
    assistant.setReportReady(true);
    // On the single page the finished lookup leaves one compact summary in the conversation; the rest is a tap away.
    assistant.foldBefore(announceReport(body));
    focusIdentity();
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
    var syncMode = function () { if (state.report) state.report.syncMode(); };
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
    assistant.say("Tell me what item you're researching. You can start with a brand and model number.");
    watchLayout();
    checkAvailability();
  }

  init();
})();
