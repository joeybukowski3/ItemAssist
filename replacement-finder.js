/*
 * Replacement Finder (proof of concept): form handling, request state and view switching.
 * The only network call is a same-origin POST to /api/replacement-finder. There is no scoring or matching logic here.
 */
(function () {
  "use strict";

  var RF = window.RFShared;
  var R = window.RFRender;
  var API_URL = "/api/replacement-finder";
  var CLIENT_TIMEOUT_MS = 30000;
  var STAGE_INTERVAL_MS = 3500;

  var form = document.getElementById("rf-form");
  var results = document.getElementById("rf-results");
  var submit = document.getElementById("rf-submit");
  var brandInput = document.getElementById("rf-brand");
  var modelInput = document.getElementById("rf-model");
  var notesInput = document.getElementById("rf-notes");
  var websiteInput = document.getElementById("rf-website");
  var exampleButton = document.getElementById("rf-use-example");
  var errorSummary = document.getElementById("rf-error-summary");
  var errorList = document.getElementById("rf-error-list");

  var state = { category: "television", controller: null, stageTimer: null, run: 0 };

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  /* ---------- Form ---------- */

  function currentCategory() {
    var checked = form.querySelector('input[name="category"]:checked');
    return checked ? checked.value : "television";
  }

  function setCategory(category) {
    var previous = RF.SUPPORT[state.category];
    var next = RF.SUPPORT[category];
    state.category = category;
    var radio = document.getElementById("rf-cat-" + category);
    if (radio) radio.checked = true;
    brandInput.value = next.brand;
    exampleButton.textContent = next.example;
    var typed = modelInput.value.trim().toUpperCase();
    if (!typed || typed === previous.example) modelInput.value = "";
    clearErrors();
  }

  function showFieldError(id, message) {
    var field = document.getElementById("rf-" + id);
    var note = document.getElementById("rf-" + id + "-error");
    if (!field || !note) return;
    note.textContent = message;
    note.hidden = false;
    field.setAttribute("aria-invalid", "true");
  }

  function clearErrors() {
    ["model", "notes"].forEach(function (id) {
      var note = document.getElementById("rf-" + id + "-error");
      var field = document.getElementById("rf-" + id);
      note.hidden = true;
      note.textContent = "";
      field.removeAttribute("aria-invalid");
    });
    errorSummary.hidden = true;
    errorList.textContent = "";
  }

  function showErrors(errors) {
    clearErrors();
    var messages = [];
    ["model", "notes", "brand", "category", "form"].forEach(function (key) {
      if (!errors[key]) return;
      messages.push({ key: key, text: errors[key] });
      if (key === "model" || key === "notes") showFieldError(key, errors[key]);
    });
    messages.forEach(function (message) {
      var target = message.key === "notes" ? "rf-notes" : "rf-model";
      var link = R.h("a", { text: message.text, attrs: { href: "#" + target } });
      link.addEventListener("click", function (event) { event.preventDefault(); document.getElementById(target).focus(); });
      errorList.appendChild(R.h("li", {}, [link]));
    });
    errorSummary.hidden = false;
    errorSummary.focus();
  }

  function readForm() {
    return {
      category: currentCategory(),
      brand: brandInput.value,
      model: modelInput.value,
      notes: notesInput.value,
      website: websiteInput.value
    };
  }

  /* ---------- Views ---------- */

  function show(node, focusId) {
    results.replaceChildren(node);
    results.setAttribute("aria-busy", "false");
    var target = focusId && document.getElementById(focusId);
    if (target) target.focus({ preventScroll: true });
    results.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
  }

  function clearResults() {
    results.replaceChildren();
    results.setAttribute("aria-busy", "false");
  }

  function stopLoading() {
    if (state.stageTimer) window.clearInterval(state.stageTimer);
    state.stageTimer = null;
    state.controller = null;
    submit.disabled = false;
  }

  function resetToForm(focusModel) {
    state.run += 1;
    if (state.controller) state.controller.abort();
    stopLoading();
    clearResults();
    if (focusModel) modelInput.focus();
    form.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
  }

  function showLoading() {
    var loading = R.renderLoading({ onCancel: function () { resetToForm(true); } });
    var step = 0;
    results.setAttribute("aria-busy", "true");
    results.replaceChildren(loading.node);
    results.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
    document.getElementById("rf-loading-h").focus({ preventScroll: true });
    // The stage list is a UI sequence describing the work, not live server state; the last stage holds until the reply.
    state.stageTimer = window.setInterval(function () {
      if (step < loading.stageCount - 1) { step += 1; loading.setStep(step); }
    }, STAGE_INTERVAL_MS);
  }

  function showError(code) {
    show(R.renderError(code, { onRetry: function () { resetToForm(true); } }), "rf-error-h");
  }

  function showUnsupported(model) {
    show(R.renderUnsupported(model, {
      onPick: function (category) { setCategory(category); resetToForm(true); },
      onRetry: function () { resetToForm(true); }
    }), "rf-unsupported-h");
  }

  function renderResponse(body, model) {
    var known = body && typeof body === "object";
    if (known && body.status === "UNSUPPORTED") return showUnsupported(model);
    if (known && body.status === "ERROR") return showError(body.errorCode);
    if (known && RF.STATUSES.indexOf(body.status) !== -1 && body.original && Array.isArray(body.comparison)) {
      return show(R.renderReport(body, { onReset: function () { resetToForm(true); } }), "rf-report-h");
    }
    return showError("ENGINE_ERROR");
  }

  /* ---------- Request ---------- */

  async function lookup(payload) {
    var run = ++state.run;
    var controller = new AbortController();
    state.controller = controller;
    submit.disabled = true;
    showLoading();
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
    if (outcome.network) return showError(outcome.aborted ? "ENGINE_TIMEOUT" : "NETWORK_ERROR");
    renderResponse(outcome.body, payload.model);
  }

  function onSubmit(event) {
    event.preventDefault();
    var checked = RF.validateLookup(readForm());
    if (!checked.ok) return showErrors(checked.errors);
    clearErrors();
    modelInput.value = checked.value.model;
    lookup(checked.value);
  }

  async function checkAvailability() {
    try {
      var response = await fetch(API_URL, { method: "GET", headers: { Accept: "application/json" }, credentials: "same-origin" });
      var body = await response.json();
      if (body && body.enabled === false) {
        document.getElementById("rf-unavailable").hidden = false;
        submit.disabled = true;
      }
    } catch (error) { /* availability is a courtesy; a real request reports its own errors */ }
  }

  function init() {
    form.addEventListener("submit", onSubmit);
    form.addEventListener("change", function (event) {
      if (event.target && event.target.name === "category") setCategory(event.target.value);
    });
    modelInput.addEventListener("input", clearErrors);
    exampleButton.addEventListener("click", function () {
      modelInput.value = RF.SUPPORT[state.category].example;
      clearErrors();
      modelInput.focus();
    });
    exampleButton.textContent = RF.SUPPORT[state.category].example;
    checkAvailability();
  }

  init();
})();
