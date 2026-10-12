/*
 * ItemAssist Assistant pane: the conversation log, the quick-action chips, the composer and the structured
 * "Find a replacement" prompt. It collects input and reports intent to the controller through hooks; it never calls the
 * network and holds no matching logic. Field validation is RFShared.validateLookup, the same rules the proxy enforces.
 */
(function (root) {
  "use strict";

  var RF = root.RFShared;
  var D = root.RFDom;
  var h = D.h;
  var icon = D.icon;
  var MAX_COMPOSER_HEIGHT = 120;
  var NARROW_BAR_ALLOWANCE = 112; // the sticky bar and a little breathing room when deciding whether a message fits above the composer
  var STAGES = [
    ["Identifying original product", "Matching the model number to the original product"],
    ["Verifying specifications", "Checking key specifications against product sources"],
    ["Evaluating current models", "Reviewing models currently available in the same line"],
    ["Comparing requirements", "Testing each candidate against the original requirements"],
    ["Selecting best replacement", "Choosing the closest defensible match"]
  ];

  function prefersReducedMotion() {
    return root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  /**
   * @param {{log: HTMLElement, quick: HTMLElement, form: HTMLFormElement, input: HTMLTextAreaElement, unavailable: HTMLElement, toggle: HTMLButtonElement}} els
   * @param {{onLookup: Function, onQuick: Function, onFreeText: Function, onCancelLoading: Function, isNarrow: Function}} hooks
   */
  function create(els, hooks) {
    var state = { prompt: null, busy: false, enabled: true };

    /**
     * Keeps the newest message in view. Beside the report the log is its own scroller; on a narrow screen it is part of the page,
     * so the page scrolls instead. The composer is pinned to the bottom there (and the page's scroll padding leaves room for it),
     * so a message that fits is brought just above it, and one taller than the screen shows its start.
     */
    function reveal(node) {
      var behavior = prefersReducedMotion() ? "auto" : "smooth";
      if (!(hooks.isNarrow && hooks.isNarrow())) {
        els.log.scrollTo({ top: els.log.scrollHeight, behavior: behavior });
        return;
      }
      var tooTall = node.offsetHeight > root.innerHeight - els.form.offsetHeight - NARROW_BAR_ALLOWANCE;
      node.scrollIntoView({ block: tooTall ? "start" : "nearest", behavior: behavior });
    }

    /* ---------- Earlier conversation (single page) ---------- */

    /** The "View conversation" control shows only when something is folded away; its label follows the state. */
    function syncToggle() {
      if (!els.toggle) return;
      var expanded = els.log.getAttribute("data-expanded") === "true";
      els.toggle.hidden = !els.log.querySelector(".rf-msg--folded");
      els.toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
      els.toggle.textContent = expanded ? "Hide conversation" : "View conversation";
    }

    /**
     * Folds every message before `node` out of view on the single page, so a finished lookup leaves a compact summary instead of the whole
     * history. Nothing is deleted: the toggle brings it back, and it never applies beside the report (the CSS rule is single-page only).
     */
    function foldBefore(node) {
      var messages = Array.prototype.slice.call(els.log.children);
      var cut = messages.indexOf(node);
      messages.forEach(function (child, index) { child.classList.toggle("rf-msg--folded", index < cut); });
      els.log.removeAttribute("data-expanded");
      syncToggle();
    }

    if (els.toggle) {
      els.toggle.addEventListener("click", function () {
        if (els.log.getAttribute("data-expanded") === "true") els.log.removeAttribute("data-expanded"); else els.log.setAttribute("data-expanded", "true");
        syncToggle();
      });
    }

    /** The pinned composer's height, so the page can leave exactly that much room at its end. */
    function publishComposerHeight() {
      document.documentElement.style.setProperty("--rf-composer-h", els.form.offsetHeight + "px");
    }
    publishComposerHeight();
    if (typeof root.ResizeObserver === "function") new root.ResizeObserver(publishComposerHeight).observe(els.form);

    function message(role, children, extraClass) {
      var node = h("div", { class: "rf-msg rf-msg--" + role + (extraClass ? " " + extraClass : "") }, [
        h("p", { class: "rf-msg-who", text: role === "user" ? "You" : "ItemAssist" }),
        h("div", { class: "rf-msg-body" }, children)
      ]);
      els.log.appendChild(node);
      reveal(node);
      return node;
    }

    function say(children, extraClass) {
      return message("assistant", typeof children === "string" ? [h("p", { text: children })] : children, extraClass);
    }

    function userSays(text) {
      return message("user", [h("p", { text: text })]);
    }

    /* ---------- Structured prompt ---------- */

    function field(id, labelText, control, hintId, extra) {
      return h("div", { class: "rf-field" + (extra ? " " + extra : "") }, [h("label", { text: labelText, attrs: { for: id } }), control]);
    }

    function buildPrompt(initial) {
      var support = RF.SUPPORT;
      var category = initial.category || "television";
      var radios = Object.keys(support).map(function (key) {
        return [
          h("input", { attrs: { type: "radio", id: "rf-cat-" + key, name: "category", value: key, checked: key === category ? "" : null } }),
          h("label", { text: support[key].label, attrs: { for: "rf-cat-" + key } })
        ];
      });
      var brand = h("input", { attrs: { id: "rf-brand", name: "brand", type: "text", value: support[category].brand, readonly: "", "aria-describedby": "rf-brand-hint" } });
      var model = h("input", { class: "rf-mono", attrs: { id: "rf-model", name: "model", type: "text", maxlength: 40, autocomplete: "off", autocapitalize: "characters", spellcheck: "false", required: "", "aria-describedby": "rf-model-hint rf-model-error" } });
      var notes = h("textarea", { attrs: { id: "rf-notes", name: "notes", rows: 2, maxlength: 300, placeholder: "Must fit existing opening, reusing wall mount, etc.", "aria-describedby": "rf-notes-hint rf-notes-error" } });
      var example = h("button", { class: "rf-link-button", attrs: { type: "button", id: "rf-use-example" }, text: support[category].example });
      var form = h("form", { class: "rf-ask", attrs: { id: "rf-ask", novalidate: "", "aria-labelledby": "rf-ask-h" } }, [
        D.heading("h3", "rf-ask-h", "Find a replacement", "rf-ask-title"),
        h("p", { class: "rf-hint", text: "Currently supports Samsung televisions and LG refrigerators." }),
        h("div", { class: "form-honeypot", attrs: { "aria-hidden": "true" } }, [h("label", { text: "Website", attrs: { for: "rf-website" } }), h("input", { attrs: { type: "text", id: "rf-website", name: "website", tabindex: "-1", autocomplete: "off" } })]),
        h("div", { class: "rf-error-summary", attrs: { id: "rf-error-summary", role: "alert", tabindex: "-1", hidden: "" } }, [
          h("p", {}, [h("strong", { text: "Please fix the following:" })]), h("ul", { attrs: { id: "rf-error-list" } })
        ]),
        h("fieldset", { class: "rf-field" }, [h("legend", { text: "Category" }), h("div", { class: "rf-seg" }, [].concat.apply([], radios))]),
        h("div", { class: "rf-ask-row" }, [
          field("rf-brand", "Brand", h("div", { class: "rf-readonly" }, [brand, icon("lock")])),
          field("rf-model", "Model number", model)
        ]),
        h("p", { class: "rf-hint", attrs: { id: "rf-model-hint" } }, ["Example: ", example]),
        h("p", { class: "rf-field-error", attrs: { id: "rf-model-error", hidden: "" } }),
        h("p", { class: "rf-visually-hidden", attrs: { id: "rf-brand-hint" }, text: "Currently supported for this category." }),
        field("rf-notes", "Optional notes", notes),
        h("p", { class: "rf-hint", attrs: { id: "rf-notes-hint" }, text: "Installation and fit requirements can affect the recommendation." }),
        h("p", { class: "rf-field-error", attrs: { id: "rf-notes-error", hidden: "" } }),
        h("div", { class: "rf-ask-actions" }, [
          h("button", { class: "rf-cta", attrs: { type: "submit", id: "rf-submit", disabled: state.enabled ? null : "" } }, ["Find Replacement", icon("arrow")]),
          h("button", { class: "rf-secondary", attrs: { type: "button", id: "rf-ask-cancel" }, text: "Cancel" })
        ])
      ]);
      model.value = initial.model || "";
      notes.value = initial.notes || "";
      bindPrompt(form, { brand: brand, model: model, notes: notes, example: example, category: category });
      return form;
    }

    function bindPrompt(form, refs) {
      var current = refs.category;
      function clearErrors() {
        ["model", "notes"].forEach(function (id) {
          var note = form.querySelector("#rf-" + id + "-error");
          note.hidden = true;
          note.textContent = "";
          form.querySelector("#rf-" + id).removeAttribute("aria-invalid");
        });
        form.querySelector("#rf-error-summary").hidden = true;
        form.querySelector("#rf-error-list").textContent = "";
      }
      function showErrors(errors) {
        clearErrors();
        var list = form.querySelector("#rf-error-list");
        ["model", "notes", "brand", "category", "form"].forEach(function (key) {
          if (!errors[key]) return;
          var target = key === "notes" ? "rf-notes" : "rf-model";
          if (key === "model" || key === "notes") {
            var note = form.querySelector("#rf-" + key + "-error");
            note.textContent = errors[key];
            note.hidden = false;
            form.querySelector("#rf-" + key).setAttribute("aria-invalid", "true");
          }
          var link = h("a", { text: errors[key], attrs: { href: "#" + target } });
          link.addEventListener("click", function (event) { event.preventDefault(); form.querySelector("#" + target).focus(); });
          list.appendChild(h("li", {}, [link]));
        });
        var summary = form.querySelector("#rf-error-summary");
        summary.hidden = false;
        summary.focus();
      }
      function setCategory(category) {
        var previous = RF.SUPPORT[current];
        current = category;
        refs.brand.value = RF.SUPPORT[category].brand;
        refs.example.textContent = RF.SUPPORT[category].example;
        var typed = refs.model.value.trim().toUpperCase();
        if (!typed || typed === previous.example) refs.model.value = "";
        clearErrors();
      }
      form.addEventListener("change", function (event) { if (event.target && event.target.name === "category") setCategory(event.target.value); });
      refs.model.addEventListener("input", clearErrors);
      refs.example.addEventListener("click", function () { refs.model.value = RF.SUPPORT[current].example; clearErrors(); refs.model.focus(); });
      form.querySelector("#rf-ask-cancel").addEventListener("click", closePrompt);
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        if (state.busy || !state.enabled) return;
        var checked = RF.validateLookup({
          category: form.querySelector('input[name="category"]:checked').value, brand: refs.brand.value, model: refs.model.value,
          notes: refs.notes.value, website: form.querySelector("#rf-website").value
        });
        if (!checked.ok) return showErrors(checked.errors);
        clearErrors();
        refs.model.value = checked.value.model;
        hooks.onLookup(checked.value);
      });
    }

    function openPrompt(initial) {
      if (state.prompt) {
        var model = state.prompt.form.querySelector("#rf-model");
        if (initial && initial.model) model.value = initial.model;
        model.focus();
        return state.prompt;
      }
      var form = buildPrompt(initial || {});
      var node = say([h("p", { text: "Which item should I research? Enter the brand and model number." }), form], "rf-msg--prompt");
      state.prompt = { node: node, form: form };
      form.querySelector("#rf-model").focus({ preventScroll: true });
      return state.prompt;
    }

    function closePrompt() {
      if (!state.prompt) return;
      state.prompt.node.remove();
      state.prompt = null;
      els.input.focus();
    }

    /** Turns the open prompt into a plain user message once a valid lookup starts. */
    function commitPrompt(value) {
      if (state.prompt) { state.prompt.node.remove(); state.prompt = null; }
      var line = "Find replacement: " + value.brand + " " + value.model;
      var node = message("user", [h("p", { text: line }), value.notes ? h("p", { class: "rf-msg-note", text: "Notes: " + value.notes }) : null]);
      if (els.log.querySelector(".rf-msg--summary")) foldBefore(node);
      return node;
    }

    /* ---------- Loading ---------- */

    /** Staged "what ItemAssist is doing" list. It is a UI sequence, not live server state, so it never claims progress. */
    function showLoading(model) {
      var items = STAGES.map(function (stage) {
        return h("li", {}, [h("span", { class: "rf-dot" }), h("span", {}, [h("b", { text: stage[0] }), h("span", { class: "rf-stage-sub", text: stage[1] })])]);
      });
      var list = h("ol", { class: "rf-stages" }, items);
      var bar = h("i", {});
      var cancel = D.button("Cancel", "rf-secondary", hooks.onCancelLoading);
      var node = say([
        D.heading("p", "rf-loading-h", "Researching " + model, "rf-loading-title"),
        list,
        h("div", { class: "rf-progress", attrs: { "aria-hidden": "true" } }, [bar]),
        h("p", { class: "rf-hint", text: "This may take up to about 20 seconds." }),
        cancel
      ], "rf-msg--loading");
      node.setAttribute("role", "status");
      function setStep(step) {
        Array.prototype.forEach.call(list.children, function (item, index) {
          item.className = index < step ? "done" : index === step ? "active" : "";
          item.firstChild.textContent = index < step ? "✓" : "";
          if (index === step) item.setAttribute("aria-current", "step"); else item.removeAttribute("aria-current");
        });
        bar.style.transform = "scaleX(" + Math.min(1, (step + 0.5) / STAGES.length) + ")";
      }
      setStep(0);
      node.querySelector("#rf-loading-h").focus({ preventScroll: true });
      return { node: node, setStep: setStep, stageCount: STAGES.length };
    }

    /* ---------- Quick actions and composer ---------- */

    function setBusy(busy) {
      state.busy = busy;
      var submit = els.log.querySelector("#rf-submit");
      if (submit) submit.disabled = busy || !state.enabled;
    }

    function setAvailability(enabled) {
      state.enabled = enabled;
      els.unavailable.hidden = enabled;
      var submit = els.log.querySelector("#rf-submit");
      if (submit) submit.disabled = !enabled || state.busy;
      els.quick.querySelector('[data-action="find"]').setAttribute("aria-disabled", enabled ? "false" : "true");
    }

    /** Report actions stay focusable but are marked unavailable until a report exists, so the page never pretends they work. */
    function setReportReady(ready) {
      Array.prototype.forEach.call(els.quick.querySelectorAll("[data-needs-report]"), function (chip) {
        chip.setAttribute("aria-disabled", ready ? "false" : "true");
        chip.hidden = chip.getAttribute("data-only-with-report") === "true" && !ready;
      });
    }

    function autosize() {
      els.input.style.height = "auto";
      els.input.style.height = Math.min(els.input.scrollHeight, MAX_COMPOSER_HEIGHT) + "px";
    }

    els.quick.addEventListener("click", function (event) {
      var chip = event.target.closest("[data-action]");
      if (!chip || state.busy) return;
      hooks.onQuick(chip.getAttribute("data-action"), chip.getAttribute("aria-disabled") === "true");
    });
    els.input.addEventListener("input", autosize);
    els.input.addEventListener("keydown", function (event) {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); els.form.requestSubmit(); }
    });
    els.form.addEventListener("submit", function (event) {
      event.preventDefault();
      var text = RF.clean(els.input.value);
      if (!text || state.busy) return;
      els.input.value = "";
      autosize();
      hooks.onFreeText(text);
    });

    return {
      say: say, userSays: userSays, openPrompt: openPrompt, closePrompt: closePrompt, commitPrompt: commitPrompt, showLoading: showLoading, foldBefore: foldBefore,
      setBusy: setBusy, setAvailability: setAvailability, setReportReady: setReportReady, isPromptOpen: function () { return Boolean(state.prompt); },
      focusComposer: function () { els.input.focus(); },
      moveFocusTo: function (node) { node.tabIndex = -1; node.focus({ preventScroll: true }); }
    };
  }

  root.RFAssistant = { create: create };
})(window);
