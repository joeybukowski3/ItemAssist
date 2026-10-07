/*
 * DOM rendering for the Replacement Finder proof of concept.
 *
 * Every string that came from the API is inserted with textContent (through `h`) and is never parsed as markup. Links are
 * built from URLs that passed RFShared.isSafeSourceUrl. There is no matching, scoring or classification logic here:
 * the page shows what the engine decided and explains it with the engine's own labels.
 */
(function (root) {
  "use strict";

  var RF = root.RFShared;
  var SVG_NS = "http://www.w3.org/2000/svg";
  var MAX_ALTERNATIVES = 2;
  var STAGES = [
    ["Identifying original product", "Matching the model number to the original product"],
    ["Verifying specifications", "Checking key specifications against product sources"],
    ["Evaluating current models", "Reviewing models currently available in the same line"],
    ["Comparing requirements", "Testing each candidate against the original requirements"],
    ["Selecting best replacement", "Choosing the closest defensible match"]
  ];

  /** Element builder. `text` and string children become text nodes; nothing is parsed as HTML. */
  function h(tag, props, children) {
    var node = document.createElement(tag);
    var options = props || {};
    if (options.class) node.className = options.class;
    if (options.text !== undefined && options.text !== null) node.textContent = String(options.text);
    if (options.attrs) {
      Object.keys(options.attrs).forEach(function (name) {
        if (options.attrs[name] !== null && options.attrs[name] !== undefined) node.setAttribute(name, String(options.attrs[name]));
      });
    }
    if (options.on) {
      Object.keys(options.on).forEach(function (name) { node.addEventListener(name, options.on[name]); });
    }
    (children || []).forEach(function (child) {
      if (child === null || child === undefined || child === false) return;
      node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    });
    return node;
  }

  function icon(name) {
    var svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "rf-ic");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    var use = document.createElementNS(SVG_NS, "use");
    use.setAttribute("href", "#rf-i-" + name);
    svg.appendChild(use);
    return svg;
  }

  function button(label, className, onClick) {
    return h("button", { class: className, text: label, attrs: { type: "button" }, on: { click: onClick } });
  }

  function heading(tag, id, text, className) {
    return h(tag, { class: className || "", text: text, attrs: { id: id, tabindex: "-1" } });
  }

  function card(labelledBy, className, children) {
    return h("section", { class: "rf-card " + (className || ""), attrs: { "aria-labelledby": labelledBy } }, children);
  }

  var FACT_ICONS = { VERIFIED: "check", PROVIDED: "user", INFERRED: "diamond", ASSUMED: "approx", AMBIGUOUS: "q", UNKNOWN: "q" };

  /** Status is always text first: the icon and tint only reinforce it. */
  function factBadge(status) {
    return h("span", { class: "rf-badge rf-badge--" + status.toLowerCase() }, [icon(FACT_ICONS[status] || "q"), RF.FACT_STATUS_LABELS[status] || "Unknown"]);
  }

  var CHIP_ORDER = ["VERIFIED", "PROVIDED", "INFERRED", "ASSUMED", "AMBIGUOUS", "UNKNOWN"];
  var CHIP_LABELS = { VERIFIED: "Verified", PROVIDED: "Provided", INFERRED: "Inferred", ASSUMED: "Assumed", AMBIGUOUS: "Sources disagree", UNKNOWN: "Unknown" };

  /** Fact-status counts, derived only from the facts the engine returned. Statuses with no facts are omitted. */
  function statusChips(facts) {
    var chips = CHIP_ORDER.map(function (status) {
      var count = facts.filter(function (fact) { return fact.status === status; }).length;
      return count ? h("li", { class: "rf-chip rf-chip--" + status.toLowerCase() }, [h("b", { text: count }), CHIP_LABELS[status]]) : null;
    }).filter(Boolean);
    return chips.length ? h("ul", { class: "rf-chips", attrs: { "aria-label": "Specification status counts" } }, chips) : null;
  }

  function renderOriginal(data) {
    var cells = data.original.facts.map(function (fact) {
      var unknown = fact.value === null;
      return h("div", { class: "rf-fact" }, [
        h("dt", { text: fact.label }),
        h("dd", { class: unknown ? "rf-unknown" : "", text: unknown ? "Not available" : fact.value }),
        factBadge(fact.status)
      ]);
    });
    return card("rf-original-h", "", [
      h("div", { class: "rf-card-head" }, [
        h("div", {}, [
          h("p", { class: "rf-eyebrow", text: "Original product" }),
          heading("h3", "rf-original-h", data.original.displayName || data.original.model, "rf-card-title"),
          statusChips(data.original.facts)
        ]),
        data.original.model ? h("p", { class: "rf-model-tag" }, [h("span", { text: "Model" }), h("span", { class: "rf-mono", text: data.original.model })]) : null
      ]),
      cells.length ? h("dl", { class: "rf-facts" }, cells) : h("p", { class: "rf-muted", text: "No specifications could be verified for this model yet." })
    ]);
  }

  function confidence(level, bare) {
    var bars = [1, 2, 3].map(function (n) {
      return h("i", { class: n <= { LOW: 1, MEDIUM: 2, HIGH: 3 }[level] ? "on" : "", attrs: { "aria-hidden": "true" } });
    });
    return h("span", { class: "rf-conf" }, [
      bare ? null : "Confidence ", h("span", { class: "rf-conf-bars", attrs: { "aria-hidden": "true" } }, bars), h("strong", { text: RF.CONFIDENCE_LABELS[level] || "" })
    ]);
  }

  function classPill(classification) {
    var glyph = classification === "UNCONFIRMED" ? "q" : classification === "NOT_LKQ" ? "x" : classification === "ABOVE_LKQ" ? "up" : "check";
    return h("span", { class: "rf-class rf-class--" + classification.toLowerCase() }, [icon(glyph), RF.CLASSIFICATION_LABELS[classification] || ""]);
  }

  function metaCell(label, content) {
    return h("div", { class: "rf-meta-cell" }, [h("p", { class: "rf-meta-label", text: label }), content]);
  }

  function renderPrimary(primary) {
    var best = primary.isBestAvailableOnly;
    var body = [
      h("p", { class: "rf-eyebrow", text: best ? "Best available option found" : "Recommended replacement" }),
      heading("h3", "rf-primary-h", primary.displayName, "rf-primary-title"),
      primary.model ? h("p", { class: "rf-primary-model" }, ["Model", h("span", { class: "rf-mono", text: primary.model })]) : null,
      h("div", { class: "rf-meta" }, [
        metaCell("Classification", classPill(primary.classification)),
        metaCell("Confidence", confidence(primary.confidence, true))
      ]),
      h("p", { class: "rf-class-hint", text: RF.CLASSIFICATION_HINTS[primary.classification] || "" })
    ];
    var why = [h("h4", { text: best ? "About this option" : "Why ItemAssist selected this" })];
    if (best) {
      why.push(h("p", { class: "rf-best-warning", attrs: { role: "note" } }, [icon("info"),
        "This model does not fully satisfy the like-kind-and-quality requirements. Review the comparison below before relying on it."]));
    }
    why.push(h("p", { class: "rf-why", text: primary.explanation }));
    return h("section", { class: "rf-primary" + (best ? " rf-primary--best" : ""), attrs: { "aria-labelledby": "rf-primary-h" } },
      [h("div", { class: "rf-primary-grid" }, [h("div", {}, body), h("div", {}, why)])]);
  }

  /**
   * Compact analytical strip. Every value is a count or label taken from the contract; a metric with no underlying data is omitted,
   * and there is deliberately no overall score or percentage.
   */
  function kpi(label, value, sub, tone) {
    return h("div", { class: "rf-kpi rf-kpi--" + tone }, [
      h("dt", { text: label }), h("dd", { class: "rf-kpi-value", text: value }), sub ? h("dd", { class: "rf-kpi-sub", text: sub }) : null
    ]);
  }

  function renderKpis(data) {
    var metrics = [];
    var facts = data.original.facts;
    if (facts.length) {
      var verified = facts.filter(function (fact) { return fact.status === "VERIFIED"; }).length;
      metrics.push(kpi("Verified facts", String(verified), "of " + facts.length + (facts.length === 1 ? " fact" : " facts"), verified ? "ok" : "neutral"));
    }
    var required = data.primary && data.comparison.length
      ? RF.summarizeComparison(data.comparison, data.needsVerification).groups.filter(function (group) { return group.importance === "REQUIRED"; })[0] : null;
    if (required && required.total) {
      var open = required.unverified ? required.unverified + " unverified" : required.unmet ? required.unmet + (required.unmet === 1 ? " differs" : " differ") : "All met";
      metrics.push(kpi("Required matched", required.met + " / " + required.total, open, required.met === required.total ? "ok" : required.unverified ? "warn" : "neutral"));
    }
    var review = data.needsVerification.length;
    if (data.primary || review) metrics.push(kpi("Needs review", String(review), review === 1 ? "item" : "items", review ? "warn" : "neutral"));
    if (data.primary && RF.CONFIDENCE_LABELS[data.primary.confidence]) {
      metrics.push(kpi("Confidence", RF.CONFIDENCE_LABELS[data.primary.confidence], data.primary.isBestAvailableOnly ? "Best available only" : RF.CLASSIFICATION_LABELS[data.primary.classification], "navy"));
    }
    return metrics.length ? h("dl", { class: "rf-kpis", attrs: { "aria-label": "Report summary" } }, metrics) : null;
  }

  function renderSummary(data) {
    var summary = RF.summarizeComparison(data.comparison, data.needsVerification);
    var tiles = summary.groups.map(function (group) {
      var ticks = data.comparison.filter(function (row) { return row.importance === group.importance; }).map(function (row) {
        var code = row.assessment.code;
        var tone = code === "MATCH" || code === "EXCEEDS" ? "ok" : ["UNKNOWN", "VERIFY", "ASSUMED"].indexOf(code) !== -1 ? "warn" : "off";
        return h("i", { class: tone, attrs: { "aria-hidden": "true" } });
      });
      var state = group.total && group.met === group.total && !group.unverified ? "ok" : group.unverified ? "warn" : "neutral";
      var notes = [];
      if (group.unverified) notes.push(group.unverified + " unverified");
      if (group.unmet) notes.push(group.unmet + (group.unmet === 1 ? " differs" : " differ"));
      return h("div", { class: "rf-tile rf-tile--" + state }, [
        h("p", { class: "rf-eyebrow", text: group.label }),
        h("p", { class: "rf-big" }, [group.met + " / " + group.total, h("small", { text: group.verb })]),
        h("div", { class: "rf-ticks" }, ticks),
        h("p", { class: "rf-tile-cap", text: notes.join(" · ") || "No open items" })
      ]);
    });
    var count = summary.needsVerificationCount;
    tiles.push(h("div", { class: "rf-tile rf-tile--verify" }, [
      h("p", { class: "rf-eyebrow", text: "Needs verification" }),
      h("p", { class: "rf-big" }, [String(count), h("small", { text: count === 1 ? "item" : "items" })]),
      h("p", { class: "rf-tile-cap", text: count ? "See Before Finalizing below" : "Nothing outstanding" })
    ]));
    return h("section", { class: "rf-summary", attrs: { "aria-labelledby": "rf-summary-h" } }, [
      h("div", { class: "rf-summary-head" }, [heading("h3", "rf-summary-h", "Match summary", "rf-eyebrow rf-sec-label")]),
      h("div", { class: "rf-tiles" }, tiles)
    ]);
  }

  function assessmentPill(assessment) {
    var look = RF.ASSESSMENT_PRESENTATION[assessment.code] || RF.ASSESSMENT_PRESENTATION.UNKNOWN;
    return h("span", { class: "rf-pill rf-pill--" + look.tone }, [icon(look.icon), assessment.label]);
  }

  function valueCell(label, value, extra) {
    return h("td", { attrs: { "data-label": label }, class: value === null ? "rf-unknown" : "" }, [value === null ? "Not available" : value].concat(extra || []));
  }

  function importanceTag(importance) {
    var level = { REQUIRED: 3, IMPORTANT: 2, ADDITIONAL: 1 }[importance];
    var dots = [1, 2, 3].map(function (n) { return h("i", { class: n <= level ? "on" : "" }); });
    return h("span", { class: "rf-imp" }, [h("span", { class: "rf-imp-dots", attrs: { "aria-hidden": "true" } }, dots), RF.IMPORTANCE_LABELS[importance]]);
  }

  function renderComparison(data) {
    var previous = "";
    var rows = data.comparison.map(function (row) {
      var separated = previous && previous !== row.importance;
      previous = row.importance;
      var tone = (RF.ASSESSMENT_PRESENTATION[row.assessment.code] || RF.ASSESSMENT_PRESENTATION.UNKNOWN).tone;
      return h("tr", { class: separated ? "rf-sep" : "", attrs: { "data-tone": tone } }, [
        h("th", { attrs: { scope: "row" } }, [h("span", { class: "rf-spec", text: row.label }), importanceTag(row.importance)]),
        valueCell("Original", row.original),
        valueCell("Recommended", row.replacement),
        h("td", { attrs: { "data-label": "Assessment" } }, [assessmentPill(row.assessment), row.note ? h("small", { text: row.note }) : null])
      ]);
    });
    var head = ["Specification", "Original", "Recommended", "Assessment"].map(function (label) { return h("th", { text: label, attrs: { scope: "col" } }); });
    return card("rf-compare-h", "rf-compare", [
      h("div", { class: "rf-card-head" }, [h("div", {}, [
        heading("h3", "rf-compare-h", "Specification comparison", "rf-eyebrow rf-sec-label")
      ])]),
      h("div", { class: "rf-table-wrap" }, [h("table", { class: "rf-table" }, [
        h("caption", { class: "rf-visually-hidden", text: "Original product compared with the recommended model" }),
        h("thead", {}, [h("tr", {}, head)]),
        h("tbody", {}, rows)
      ])])
    ]);
  }

  function renderNeeds(data) {
    var needs = data.needsVerification.map(function (item) {
      return h("li", { class: "rf-need" }, [
        h("h4", {}, [icon("q"), item.label, h("span", { class: "rf-reason", text: RF.REASON_LABELS[item.reason] || "" })]),
        h("p", { text: item.message })
      ]);
    });
    var warnings = data.warnings.map(function (item) {
      return h("li", { class: "rf-need rf-need--warning" }, [
        h("h4", {}, [icon("info"), RF.SEVERITY_LABELS[item.severity] || "Note"]),
        h("p", { text: item.message })
      ]);
    });
    return h("section", { class: "rf-needs", attrs: { "aria-labelledby": "rf-needs-h" } }, [
      heading("h3", "rf-needs-h", "Before Finalizing", "rf-eyebrow rf-sec-label"),
      h("p", { class: "rf-needs-lede", text: "A few details could not be confirmed from available sources. Checking them takes a minute." }),
      h("ul", { class: "rf-need-list" }, needs.concat(warnings))
    ]);
  }

  function renderAlternatives(data) {
    var cards = data.alternatives.slice(0, MAX_ALTERNATIVES).map(function (alt) {
      var differences = alt.differences.map(function (text) { return h("li", { text: text }); });
      return h("article", { class: "rf-alt" }, [
        h("p", { class: "rf-eyebrow", text: alt.roleLabel || "Alternative" }),
        h("h4", { text: alt.displayName }),
        h("div", { class: "rf-alt-meta" }, [classPill(alt.classification), confidence(alt.confidence)]),
        differences.length ? h("div", {}, [h("p", { class: "rf-alt-label", text: "Main differences" }), h("ul", { class: "rf-alt-diff" }, differences)]) : null
      ]);
    });
    return h("section", { class: "rf-alts-section", attrs: { "aria-labelledby": "rf-alts-h" } }, [
      h("div", { class: "rf-sec-title" }, [heading("h3", "rf-alts-h", "Alternatives", "rf-eyebrow rf-sec-label"), h("p", { text: "Secondary options, shown for comparison with the primary result." })]),
      h("div", { class: "rf-alts" }, cards)
    ]);
  }

  function renderSources(data) {
    var items = data.sources.filter(function (source) { return RF.isSafeSourceUrl(source.url); }).map(function (source) {
      var link = h("a", { attrs: { href: source.url, target: "_blank", rel: "noopener noreferrer" } }, [source.domain, icon("link")]);
      return h("li", {}, [link, h("span", { class: "rf-source-role", text: RF.SOURCE_ROLE_LABELS[source.role] || "" })]);
    });
    if (!items.length) return null;
    return h("section", { class: "rf-sources", attrs: { "aria-labelledby": "rf-sources-h" } }, [h("h3", { class: "rf-eyebrow rf-sec-label", text: "Sources used", attrs: { id: "rf-sources-h" } }), h("ul", {}, items)]);
  }

  function reportHead(data, handlers) {
    var partial = data.status === "PARTIAL";
    return h("div", { class: "rf-report-head" }, [
      h("div", {}, [
        heading("h2", "rf-report-h", partial ? "Partial replacement report" : data.status === "NO_RESULT" ? "No replacement found" : "Replacement report", "rf-report-title"),
        h("p", { class: "rf-report-meta", text: (RF.SUPPORT[data.category] ? RF.SUPPORT[data.category].noun : "") + " · " + (data.original.model || "") })
      ]),
      button("New lookup", "rf-secondary", handlers.onReset)
    ]);
  }

  function partialBanner() {
    return h("div", { class: "rf-partial", attrs: { role: "note" } }, [icon("info"), h("div", {}, [
      h("h3", { text: "Partial Recommendation" }),
      h("p", { text: "We found useful replacement information, but some specifications or current product data could not be fully verified." })
    ])]);
  }

  function noResultPanel() {
    return h("div", { class: "rf-panel rf-panel--calm" }, [
      h("h3", { text: "We couldn't identify a replacement yet" }),
      h("p", { text: "Not enough current product information was available to recommend a model. Everything we could confirm about the original is shown above." })
    ]);
  }

  /** @returns {HTMLElement} the full report for a COMPLETE, PARTIAL or NO_RESULT contract */
  function renderReport(data, handlers) {
    var parts = [reportHead(data, handlers)];
    if (data.status === "PARTIAL") parts.push(partialBanner());
    var kpis = renderKpis(data);
    if (kpis) parts.push(kpis);
    parts.push(renderOriginal(data));
    if (data.primary) {
      parts.push(renderPrimary(data.primary));
      if (data.comparison.length) parts.push(renderSummary(data), renderComparison(data));
    } else {
      parts.push(noResultPanel());
    }
    if (data.needsVerification.length || data.warnings.length) parts.push(renderNeeds(data));
    if (data.alternatives.length) parts.push(renderAlternatives(data));
    var sources = renderSources(data);
    if (sources) parts.push(sources);
    return h("div", { class: "rf-report" }, parts);
  }

  function renderUnsupported(model, handlers) {
    var options = Object.keys(RF.SUPPORT).map(function (key) {
      return h("li", {}, [h("button", { class: "rf-support-option", attrs: { type: "button" }, on: { click: function () { handlers.onPick(key); } } }, [
        icon("check"), h("span", {}, [h("strong", { text: RF.SUPPORT[key].noun }), h("span", { text: "Use this category" })])
      ])]);
    });
    return h("div", { class: "rf-panel rf-panel--calm rf-unsupported" }, [
      h("div", { class: "rf-panel-icon" }, [icon("info")]),
      heading("h2", "rf-unsupported-h", "This model isn't supported yet.", "rf-panel-title"),
      h("p", {}, ["We couldn't match ", h("span", { class: "rf-mono", text: model }), " to a product Replacement Finder covers today."]),
      h("p", { text: "Replacement Finder currently supports:" }),
      h("ul", { class: "rf-support-list" }, options),
      h("p", { text: "We're expanding manufacturer and category coverage as the engine is validated." }),
      button("Try another model", "rf-secondary", handlers.onRetry)
    ]);
  }

  function renderError(code, handlers) {
    return h("div", { class: "rf-panel rf-error", attrs: { role: "alert" } }, [
      heading("h2", "rf-error-h", "We couldn't complete that lookup", "rf-panel-title"),
      h("p", { text: RF.errorMessage(code) }),
      h("div", { class: "rf-actions" }, [button("Back to the form", "rf-secondary", handlers.onRetry)])
    ]);
  }

  /** Staged "what ItemAssist is doing" list. It is a UI sequence, not live server state, and says so by not claiming progress. */
  function renderLoading(handlers) {
    var items = STAGES.map(function (stage) {
      return h("li", {}, [h("span", { class: "rf-dot" }), h("span", {}, [h("b", { text: stage[0] }), h("span", { class: "rf-stage-sub", text: stage[1] })])]);
    });
    var bar = h("i", {});
    var list = h("ol", { class: "rf-stages" }, items);
    var node = h("div", { class: "rf-panel", attrs: { role: "status" } }, [
      h("p", { class: "rf-eyebrow", text: "Researching" }),
      heading("h2", "rf-loading-h", "Building your replacement report", "rf-panel-title"),
      list,
      h("div", { class: "rf-progress", attrs: { "aria-hidden": "true" } }, [bar]),
      h("p", { class: "rf-wait", text: "This may take up to about 20 seconds." }),
      button("Cancel", "rf-secondary", handlers.onCancel)
    ]);
    function setStep(step) {
      Array.prototype.forEach.call(list.children, function (item, index) {
        item.className = index < step ? "done" : index === step ? "active" : "";
        item.firstChild.textContent = index < step ? "✓" : "";
        if (index === step) item.setAttribute("aria-current", "step"); else item.removeAttribute("aria-current");
      });
      bar.style.transform = "scaleX(" + Math.min(1, (step + 0.5) / STAGES.length) + ")";
    }
    setStep(0);
    return { node: node, setStep: setStep, stageCount: STAGES.length };
  }

  root.RFRender = { h: h, renderReport: renderReport, renderUnsupported: renderUnsupported, renderError: renderError, renderLoading: renderLoading };
})(window);
