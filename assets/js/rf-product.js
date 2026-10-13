/*
 * Product Intelligence pane: empty and researching states, and the tabbed report (Overview, Specifications, Replacement,
 * Pricing, Evidence). Panels show only what the public contract carries; a section without data says so plainly instead of
 * inventing content.
 */
(function (root) {
  "use strict";

  var RF = root.RFShared;
  var D = root.RFDom;
  var R = root.RFReplacement;
  var h = D.h;
  var icon = D.icon;

  var TABS = [["overview", "Overview"], ["specs", "Specifications"], ["replacement", "Replacement"], ["pricing", "Pricing"], ["evidence", "Evidence"]];
  var COVERAGE_LABELS = { STRONG: "Strong", PARTIAL: "Partial", WEAK: "Weak", FAILED: "Failed" };
  var FACT_ICONS = { VERIFIED: "check", PROVIDED: "user", INFERRED: "diamond", ASSUMED: "approx", AMBIGUOUS: "q", UNKNOWN: "q" };
  var CHIP_ORDER = ["VERIFIED", "PROVIDED", "INFERRED", "ASSUMED", "AMBIGUOUS", "UNKNOWN"];
  var CHIP_LABELS = { VERIFIED: "Verified", PROVIDED: "Provided", INFERRED: "Inferred", ASSUMED: "Assumed", AMBIGUOUS: "Sources disagree", UNKNOWN: "Unknown" };
  var PROVENANCE_CODES = ["ORIGINAL_SOURCE_NON_US", "ORIGINAL_UNVERIFIED"];
  var PREVIEW = [
    ["Overview", "The headline result and why it was chosen"],
    ["Specifications", "Verified facts about the original product"],
    ["Replacement", "A side-by-side comparison and open questions"],
    ["Pricing", "The observed retail price, when one was found"],
    ["Evidence", "Every source behind the report"]
  ];

  function pane(children, busy) {
    return h("div", { class: "rf-pane-body", attrs: { "aria-busy": busy ? "true" : "false" } }, children);
  }

  /** Before any lookup: describes what the pane will hold. It contains no sample data. */
  function renderEmpty() {
    var items = PREVIEW.map(function (entry) { return h("li", {}, [h("strong", { text: entry[0] }), h("span", { text: entry[1] })]); });
    return pane([h("div", { class: "rf-empty" }, [
      h("p", { class: "rf-empty-lede", text: "Research an item to build its product profile, replacement analysis and evidence." }),
      h("p", { class: "rf-eyebrow", text: "What appears here" }),
      h("ul", { class: "rf-empty-list" }, items)
    ])]);
  }

  function renderResearching(model) {
    return pane([h("div", { class: "rf-empty rf-empty--busy", attrs: { role: "status" } }, [
      h("p", { class: "rf-eyebrow", text: "Researching" }),
      D.heading("h3", "rf-researching-h", model || "Product", "rf-empty-name rf-mono"),
      h("p", { class: "rf-empty-lede", text: "Building the product profile, replacement analysis and evidence." }),
      h("div", { class: "rf-skeleton", attrs: { "aria-hidden": "true" } }, [h("i", {}), h("i", {}), h("i", {}), h("i", {})])
    ])], true);
  }

  function factValue(data, key) {
    var match = data.original.facts.filter(function (fact) { return fact.key === key && fact.value; })[0];
    return match ? match.value : null;
  }

  /** Wide: full status labels. On the single page the same facts read as short chips ("Verified", "Retail", "2 to verify") so the row stays on one line. */
  function statusRow(data, narrow) {
    var modelFact = data.original.facts.filter(function (fact) { return fact.key === "model"; })[0];
    var verified = modelFact && modelFact.status === "VERIFIED";
    var needs = data.needsVerification.length;
    var retail = Boolean(data.primary && data.primary.retail);
    var coverage = COVERAGE_LABELS[data.retrievalQuality] || "Unknown";
    var pills = narrow ? [
      verified ? D.pill("ok", "check", "Verified") : D.pill("warn", "q", "Not verified"),
      retail ? D.pill("ok", "check", "Retail") : null,
      needs ? D.pill("warn", "q", needs + " to verify") : null,
      h("span", { class: "rf-coverage" }, ["Coverage ", h("strong", { text: coverage })])
    ] : [
      verified ? D.pill("ok", "check", "Verified Product") : D.pill("warn", "q", "Product Not Verified"),
      retail ? D.pill("ok", "check", "Retail Evidence") : null,
      needs ? D.pill("warn", "q", "Needs Verification · " + needs) : null,
      h("span", { class: "rf-coverage" }, ["Source coverage ", h("strong", { text: coverage })])
    ];
    return h("div", { class: "rf-status-row", attrs: { role: "group", "aria-label": "Report status" } }, pills);
  }

  function headerParts(data, narrow) {
    var type = [RF.SUPPORT[data.category] ? RF.SUPPORT[data.category].label : "", factValue(data, "series")].filter(Boolean).join(" · ");
    return [
      h("p", { class: "rf-ph-brand", text: data.original.brand }),
      D.heading("h3", "rf-product-name", data.original.model || data.original.displayName, "rf-ph-model rf-mono"),
      type ? h("p", { class: "rf-ph-type", text: type }) : null,
      statusRow(data, narrow)
    ].filter(Boolean);
  }

  /* ---------- Panels ---------- */

  /** An empty section frame; its content is filled for the current layout and its roles are set by `paint()`. */
  function panelFrame(name) {
    return h("div", { class: "rf-tabpanel", attrs: { id: "rf-panel-" + name, "data-section": name } }, []);
  }

  function factChips(facts) {
    var chips = CHIP_ORDER.map(function (status) {
      var count = facts.filter(function (fact) { return fact.status === status; }).length;
      return count ? h("li", { class: "rf-chip rf-chip--" + status.toLowerCase() }, [h("b", { text: count }), CHIP_LABELS[status]]) : null;
    }).filter(Boolean);
    return chips.length ? h("ul", { class: "rf-chips", attrs: { "aria-label": "Specification status counts" } }, chips) : null;
  }

  function factCell(fact) {
    var unknown = fact.value === null;
    return h("div", { class: "rf-fact" }, [
      h("dt", { text: fact.label }),
      h("dd", { class: unknown ? "rf-unknown" : "", text: unknown ? "Not available" : fact.value }),
      h("dd", { class: "rf-fact-status" }, [h("span", { class: "rf-badge rf-badge--" + fact.status.toLowerCase() }, [icon(FACT_ICONS[fact.status] || "q"), RF.FACT_STATUS_LABELS[fact.status] || "Unknown"])])
    ]);
  }

  /** On the single page, specifications that are not available sit in a closed disclosure so the list shows what is actually known. */
  function renderSpecs(data, narrow) {
    var facts = data.original.facts;
    if (!facts.length) return D.emptyNote("No specifications verified", "No specifications could be verified for this model yet.");
    var heading = D.heading("h3", "rf-specs-h", "Original product specifications", "rf-eyebrow rf-sec-label");
    if (!narrow) {
      return h("section", { class: "rf-block", attrs: { "aria-labelledby": "rf-specs-h" } }, [heading, factChips(facts), h("dl", { class: "rf-facts" }, facts.map(factCell))]);
    }
    var known = facts.filter(function (fact) { return fact.value !== null; });
    var unknown = facts.filter(function (fact) { return fact.value === null; });
    return h("section", { class: "rf-block", attrs: { "aria-labelledby": "rf-specs-h" } }, [
      heading,
      factChips(facts),
      known.length ? h("dl", { class: "rf-facts" }, known.map(factCell)) : null,
      unknown.length ? D.disclosure({
        id: "rf-unknown-h", title: "Not available", count: unknown.length, className: "rf-disc--unknown",
        hint: unknown.map(function (fact) { return fact.label; }).join(", ")
      }, [h("dl", { class: "rf-facts" }, unknown.map(factCell))]) : null
    ]);
  }

  function renderReplacementIntro(data) {
    var head = RF.headlineFor(data);
    if (!data.primary) return D.emptyNote(head.title, "There is no replacement to compare for this lookup.");
    return h("section", { class: "rf-block rf-intro", attrs: { "aria-labelledby": "rf-repl-h" } }, [
      D.heading("h3", "rf-repl-h", head.title, "rf-eyebrow rf-sec-label"),
      h("p", { class: "rf-intro-name rf-mono", text: data.primary.displayName }),
      h("div", { class: "rf-lead-meta" }, [R.confidence(data.primary.confidence), R.classPill(data.primary.classification), RF.hasNoConfirmedLkq(data) ? D.pill("warn", "info", "No Confirmed LKQ") : null]),
      R.renderRetail(data.primary.retail, { compact: true })
    ]);
  }

  /** On the single page the replacement is not repeated in full: Overview carries the card, and this is a one-line reference to it. */
  function renderReplacementRef(data) {
    var head = RF.headlineFor(data);
    if (!data.primary) return D.emptyNote(head.title, "There is no replacement to compare for this lookup.");
    return h("section", { class: "rf-block rf-ref", attrs: { "aria-labelledby": "rf-repl-h" } }, [
      D.heading("h3", "rf-repl-h", head.title, "rf-eyebrow rf-sec-label"),
      h("div", { class: "rf-ref-line" }, [h("span", { class: "rf-ref-name rf-mono", text: data.primary.displayName }), R.confidence(data.primary.confidence), R.classPill(data.primary.classification)])
    ]);
  }

  function priceCard(label, retail, name) {
    var price = RF.formatPrice(retail.observedPrice);
    var observed = RF.formatObservedDate(retail.observedAt);
    return h("div", { class: "rf-price-card" }, [
      h("p", { class: "rf-tile-label", text: label }),
      name ? h("p", { class: "rf-price-model rf-mono", text: name }) : null,
      h("p", { class: "rf-price-big" }, [price]),
      h("p", { class: "rf-price-meta" }, [R.sourceLink(retail.sourceUrl, retail.sourceName || retail.sourceDomain || "Seller"), observed ? " · Observed " + observed : ""])
    ]);
  }

  function renderPricing(data) {
    var primary = data.primary;
    var blocks = [];
    if (!primary) {
      blocks.push(D.emptyNote("No observed price", "No replacement was confirmed, so there is no retail price to show."));
    } else if (!primary.retail || !primary.retail.observedPrice) {
      blocks.push(D.emptyNote("No observed price", "No retail price was reported for " + primary.displayName + "."));
    } else {
      blocks.push(h("section", { class: "rf-block", attrs: { "aria-labelledby": "rf-price-h" } }, [
        D.heading("h3", "rf-price-h", "Observed retail price", "rf-eyebrow rf-sec-label"),
        priceCard(RF.headlineFor(data).title, primary.retail, primary.displayName),
        R.renderRetail(primary.retail, { compact: true, hidePrice: true }),
        h("p", { class: "rf-muted", text: "A retail observation taken during research. It is not part of the match result and can change." })
      ]));
    }
    var others = data.alternatives.filter(function (alt) { return alt.retail && alt.retail.observedPrice; });
    if (others.length) {
      blocks.push(h("section", { class: "rf-block", attrs: { "aria-labelledby": "rf-altprice-h" } }, [
        D.heading("h3", "rf-altprice-h", "Alternative models", "rf-eyebrow rf-sec-label"),
        h("div", { class: "rf-price-grid" }, others.map(function (alt) { return priceCard(alt.roleLabel || "Alternative", alt.retail, alt.displayName); }))
      ]));
    }
    blocks.push(h("section", { class: "rf-block", attrs: { "aria-labelledby": "rf-later-h" } }, [
      D.heading("h3", "rf-later-h", "Not available yet", "rf-eyebrow rf-sec-label"),
      h("ul", { class: "rf-later" }, [
        h("li", {}, [h("strong", { text: "Price history" }), "Prices are observed once per lookup; no history is tracked."]),
        h("li", {}, [h("strong", { text: "Replacement-cost calculation" }), "Cost estimates are not part of this report."])
      ])
    ]));
    return blocks;
  }

  /** Pricing on the single page: the observation only, with the seller and flags shown once. */
  function renderPricingCompact(data) {
    var primary = data.primary;
    var blocks = [];
    if (!primary) {
      blocks.push(D.emptyNote("No observed price", "No replacement was confirmed, so there is no retail price to show."));
    } else if (!primary.retail || !primary.retail.observedPrice) {
      blocks.push(D.emptyNote("No observed price", "No retail price was reported for " + primary.displayName + "."));
    } else {
      var observed = RF.formatObservedDate(primary.retail.observedAt);
      blocks.push(h("section", { class: "rf-block rf-px", attrs: { "aria-labelledby": "rf-price-h" } }, [
        D.heading("h3", "rf-price-h", "Observed retail price", "rf-eyebrow rf-sec-label"),
        h("div", { class: "rf-px-row" }, [
          h("p", { class: "rf-price-big" }, [RF.formatPrice(primary.retail.observedPrice)]),
          h("div", { class: "rf-px-who" }, [
            h("p", { class: "rf-price-model rf-mono", text: primary.displayName }),
            observed ? h("p", { class: "rf-price-meta", text: "Observed " + observed }) : null
          ])
        ]),
        R.renderRetail(primary.retail, { compact: true, hidePrice: true }),
        h("p", { class: "rf-muted", text: "A retail observation taken during research. It is not part of the match result and can change." })
      ]));
    }
    var others = data.alternatives.filter(function (alt) { return alt.retail && alt.retail.observedPrice; });
    if (others.length) {
      blocks.push(h("section", { class: "rf-block", attrs: { "aria-labelledby": "rf-altprice-h" } }, [
        D.heading("h3", "rf-altprice-h", "Alternative models", "rf-eyebrow rf-sec-label"),
        h("ul", { class: "rf-px-alts" }, others.map(function (alt) {
          var when = RF.formatObservedDate(alt.retail.observedAt);
          return h("li", {}, [
            h("span", { class: "rf-px-alt-name rf-mono", text: alt.displayName }),
            h("span", { class: "rf-px-alt-price rf-mono", text: RF.formatPrice(alt.retail.observedPrice) }),
            h("span", { class: "rf-px-alt-src" }, [R.sourceLink(alt.retail.sourceUrl, alt.retail.sourceName || alt.retail.sourceDomain || "Seller"), when ? " · Observed " + when : ""])
          ]);
        }))
      ]));
    }
    blocks.push(D.disclosure({ id: "rf-later-h", title: "Not available yet", className: "rf-disc--later" }, [
      h("ul", { class: "rf-later" }, [
        h("li", {}, [h("strong", { text: "Price history" }), "Prices are observed once per lookup; no history is tracked."]),
        h("li", {}, [h("strong", { text: "Replacement-cost calculation" }), "Cost estimates are not part of this report."])
      ])
    ]));
    return blocks;
  }

  function evidenceItem(name, verifies, url) {
    return h("li", { class: "rf-ev" }, [
      h("span", { class: "rf-ev-name", text: name }),
      h("span", { class: "rf-ev-what", text: verifies }),
      RF.isSafeSourceUrl(url) ? R.sourceLink(url, "Open source") : h("span", { class: "rf-muted", text: "No link available" })
    ]);
  }

  function evidenceGroup(id, title, items, emptyMessage, extra) {
    return h("section", { class: "rf-block", attrs: { "aria-labelledby": id } }, [
      D.heading("h3", id, title, "rf-eyebrow rf-sec-label"),
      extra || null,
      items.length ? h("ul", { class: "rf-ev-list" }, items) : h("p", { class: "rf-muted", text: emptyMessage })
    ]);
  }

  /** `compact` (single page): provenance is a pointer to the warning in Overview, and supporting sources sit in a closed disclosure. */
  function renderEvidence(data, compact, pointer) {
    var byRole = function (role) { return data.sources.filter(function (source) { return source.role === role; }); };
    var specItems = function (role, verifies) { return byRole(role).map(function (source) { return evidenceItem(source.domain, verifies, source.url); }); };
    var retailItems = [];
    if (data.primary && data.primary.retail) {
      var r = data.primary.retail;
      var price = RF.formatPrice(r.observedPrice);
      retailItems.push(evidenceItem(r.sourceName || r.sourceDomain || "Seller", data.primary.displayName + ": new, available" + (price ? ", " + price : ""), r.sourceUrl));
    }
    data.alternatives.forEach(function (alt) {
      if (alt.retail) retailItems.push(evidenceItem(alt.retail.sourceName || alt.retail.sourceDomain || "Seller", alt.displayName + ": new, available", alt.retail.sourceUrl));
    });
    var groups = [
      evidenceGroup("rf-ev-original-h", "Original product evidence", specItems("ORIGINAL", "Original product specifications"), "No original product source was available.",
        compact ? pointer(PROVENANCE_CODES) : R.renderWarnings(data, { codes: PROVENANCE_CODES, bare: true })),
      evidenceGroup("rf-ev-replacement-h", "Replacement evidence", specItems("REPLACEMENT", "Replacement specifications"), "No replacement source was available."),
      evidenceGroup("rf-ev-retail-h", "Retail availability evidence", retailItems, "No retail availability evidence was available.")
    ];
    if (byRole("SUPPORT").length) {
      var support = specItems("SUPPORT", "Supporting product information");
      groups.push(compact
        ? D.disclosure({ id: "rf-ev-support-h", title: "Supporting sources", count: support.length, className: "rf-disc--ev" }, [h("ul", { class: "rf-ev-list" }, support)])
        : evidenceGroup("rf-ev-support-h", "Supporting sources", support, ""));
    }
    return groups;
  }

  /* ---------- Report ---------- */

  var TAB_ROW_LABEL = "Product intelligence sections";
  var SPY_SLACK_PX = 24;
  var SPY_END_PX = 4;
  var SPY_LOCK_MS = 1200;

  function prefersReducedMotion() {
    return Boolean(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  /** `onSelect(name)` is called for a click or an arrow/Home/End key; arrow keys only move between tabs when the row is a real tablist. */
  function buildTabs(onSelect, isNarrow) {
    var tabs = TABS.map(function (entry) {
      return h("button", { class: "rf-tab", text: entry[1], attrs: { id: "rf-tab-" + entry[0], type: "button", "data-tab": entry[0] } });
    });
    var list = h("div", { class: "rf-tablist" }, tabs);
    list.addEventListener("click", function (event) {
      var target = event.target.closest(".rf-tab");
      if (target) onSelect(target.getAttribute("data-tab"), true);
    });
    list.addEventListener("keydown", function (event) {
      var index = tabs.indexOf(document.activeElement);
      if (index === -1 || isNarrow()) return;
      var next = { ArrowRight: (index + 1) % tabs.length, ArrowLeft: (index + tabs.length - 1) % tabs.length, Home: 0, End: tabs.length - 1 }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      onSelect(tabs[next].getAttribute("data-tab"), true);
    });
    return list;
  }

  /**
   * The report for a COMPLETE, PARTIAL or NO_RESULT contract.
   *
   * Wide (two panes): the five sections are tabs and one panel shows at a time; each section carries its full detail.
   * Narrow (one continuous page): every section is on the page in order, the same five controls are jump links to them, and the
   * content is condensed: lower-priority detail sits in disclosures and a fact is shown in the one place it is most useful.
   * The mode follows `options.isNarrow()`; call `syncMode()` when it changes (the sections are rebuilt for the new mode).
   *
   * @returns {{node: HTMLElement, header: HTMLElement, nameHeading: HTMLElement, setTab: Function, reveal: Function, syncMode: Function, syncFromScroll: Function, currentTab: Function}}
   */
  function renderReport(data, options) {
    var isNarrow = (options && options.isNarrow) || function () { return false; };
    var panels = {};
    TABS.forEach(function (entry) { panels[entry[0]] = panelFrame(entry[0]); });
    var current = TABS[0][0];
    var built = null;
    var spyLocked = false;
    var spyTimer = null;
    var list = buildTabs(function (name) { if (isNarrow()) jump(name, null); else setTab(name, true); }, isNarrow);
    var tabbar = h("div", { class: "rf-tabbar" }, [list]);
    var header = h("header", { class: "rf-ph" }, []);
    var node = h("div", { class: "rf-report" }, [header, tabbar].concat(TABS.map(function (entry) { return panels[entry[0]]; })));

    function tabFor(name) { return list.querySelector("#rf-tab-" + name); }

    /** Where a provenance warning is described in full on the single page; the other sections point to it instead of repeating it. */
    function warningPointer(codes) {
      var items = data.warnings.filter(function (warning) { return codes.indexOf(warning.code) !== -1; });
      if (!items.length) return null;
      var titles = items.map(function (warning) { return RF.WARNING_TITLES[warning.code] || RF.SEVERITY_LABELS[warning.severity] || "Note"; }).join(" \u00b7 ");
      var go = D.button("See warning", "rf-wref-go", function () { jump("overview", node.querySelector("#rf-warn-h")); });
      go.setAttribute("aria-label", "See warning: " + titles);
      return h("p", { class: "rf-wref" }, [icon("info"), h("span", { class: "rf-wref-title", text: titles }), go]);
    }

    function widePanels() {
      return {
        overview: [data.status === "PARTIAL" ? partialBanner() : null, R.renderLead(data), R.renderWhy(data), R.renderSummary(data), R.renderWarnings(data)],
        specs: [renderSpecs(data, false), R.renderWarnings(data, { codes: PROVENANCE_CODES, bare: true })],
        replacement: [renderReplacementIntro(data), R.renderComparison(data), R.renderNeeds(data), R.renderAlternatives(data)],
        pricing: renderPricing(data),
        evidence: renderEvidence(data, false)
      };
    }

    function narrowPanels() {
      var compact = { compact: true };
      return {
        overview: [data.status === "PARTIAL" ? partialBanner() : null, R.renderLead(data, compact), R.renderWarnings(data), R.renderSummary(data), R.renderWhy(data, compact)],
        specs: [warningPointer(PROVENANCE_CODES), renderSpecs(data, true)],
        replacement: [renderReplacementRef(data), R.renderComparison(data), R.renderNeeds(data, compact), R.renderAlternatives(data, compact)],
        pricing: renderPricingCompact(data),
        evidence: renderEvidence(data, true, warningPointer)
      };
    }

    /** Builds the header and every section for the current layout. */
    function fill() {
      var narrow = isNarrow();
      built = narrow;
      header.replaceChildren.apply(header, headerParts(data, narrow));
      var content = narrow ? narrowPanels() : widePanels();
      TABS.forEach(function (entry) {
        var panel = panels[entry[0]];
        panel.replaceChildren.apply(panel, content[entry[0]].filter(Boolean));
      });
    }

    /** Keeps the active tab visible inside the scrollable tab row without scrolling the page. */
    function keepTabInView(tab) {
      if (tab.offsetLeft < list.scrollLeft) list.scrollLeft = tab.offsetLeft;
      else if (tab.offsetLeft + tab.offsetWidth > list.scrollLeft + list.clientWidth) list.scrollLeft = tab.offsetLeft + tab.offsetWidth - list.clientWidth;
    }

    /** Applies `current` to the controls for the active mode. */
    function paint() {
      var narrow = isNarrow();
      // The row is a navigation landmark when it only jumps within the page, and a tablist when it switches panels.
      if (narrow) { tabbar.setAttribute("role", "navigation"); tabbar.setAttribute("aria-label", TAB_ROW_LABEL); } else { tabbar.removeAttribute("role"); tabbar.removeAttribute("aria-label"); }
      if (narrow) { list.removeAttribute("role"); list.removeAttribute("aria-label"); } else { list.setAttribute("role", "tablist"); list.setAttribute("aria-label", TAB_ROW_LABEL); }
      TABS.forEach(function (entry) {
        var name = entry[0];
        var active = name === current;
        var tab = tabFor(name);
        var panel = panels[name];
        if (narrow) {
          tab.removeAttribute("role");
          tab.removeAttribute("aria-controls");
          tab.removeAttribute("aria-selected");
          tab.tabIndex = 0;
          if (active) tab.setAttribute("aria-current", "location"); else tab.removeAttribute("aria-current");
          panel.setAttribute("role", "group");
          panel.setAttribute("aria-label", entry[1]);
          panel.removeAttribute("aria-labelledby");
          panel.tabIndex = -1;
          panel.hidden = false;
        } else {
          tab.setAttribute("role", "tab");
          tab.setAttribute("aria-controls", "rf-panel-" + name);
          tab.setAttribute("aria-selected", active ? "true" : "false");
          tab.removeAttribute("aria-current");
          tab.tabIndex = active ? 0 : -1;
          panel.setAttribute("role", "tabpanel");
          panel.setAttribute("aria-labelledby", "rf-tab-" + name);
          panel.removeAttribute("aria-label");
          panel.tabIndex = 0;
          panel.hidden = !active;
        }
      });
      keepTabInView(tabFor(current));
    }

    /** Wide mode: show one panel. */
    function setTab(name, focus) {
      if (!panels[name]) return;
      if (isNarrow()) return jump(name, null);
      current = name;
      paint();
      if (focus) tabFor(name).focus({ preventScroll: true });
    }

    function lockSpy() {
      spyLocked = true;
      root.clearTimeout(spyTimer);
      var unlock = function () { spyLocked = false; root.clearTimeout(spyTimer); root.removeEventListener("scrollend", unlock); };
      root.addEventListener("scrollend", unlock);
      spyTimer = root.setTimeout(unlock, SPY_LOCK_MS);
    }

    /** Narrow mode: scroll to a section (or an element inside it) and move focus there, as an in-page link would. A closed disclosure that holds the target is opened. */
    function jump(name, target) {
      var panel = panels[name];
      if (!panel) return;
      current = name;
      paint();
      lockSpy();
      var anchor = target || panel;
      var closed = anchor.closest("details:not([open])");
      if (closed) closed.open = true;
      anchor.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
      anchor.focus({ preventScroll: true });
    }

    /** Opens a section from outside the report (the quick actions). `selector` narrows the landing spot to an element in the section. */
    function reveal(name, selector) {
      var target = selector ? node.querySelector(selector) : null;
      if (isNarrow()) return jump(name, target);
      setTab(name, false);
      (target || tabFor(name)).focus();
    }

    /** Narrow mode: the active tab follows the section under the sticky tab row while the page scrolls. */
    function syncFromScroll() {
      if (!isNarrow() || spyLocked) return;
      var line = tabbar.getBoundingClientRect().bottom + SPY_SLACK_PX;
      var atEnd = root.innerHeight + root.scrollY >= document.documentElement.scrollHeight - SPY_END_PX;
      var name = TABS[0][0];
      TABS.forEach(function (entry) { if (panels[entry[0]].getBoundingClientRect().top <= line) name = entry[0]; });
      if (atEnd) name = TABS[TABS.length - 1][0];
      if (name === current) return;
      current = name;
      paint();
    }

    /** The layout changed (rotation, resize): rebuild the sections for it when its mode changed, and re-apply the controls. */
    function syncMode() {
      if (built !== isNarrow()) fill();
      paint();
    }

    fill();
    paint();
    return {
      node: node, header: header, get nameHeading() { return header.querySelector("#rf-product-name"); },
      setTab: setTab, reveal: reveal, syncMode: syncMode, syncFromScroll: syncFromScroll, currentTab: function () { return current; }
    };
  }

  function partialBanner() {
    return h("div", { class: "rf-partial", attrs: { role: "note" } }, [icon("info"), h("div", {}, [
      h("p", { class: "rf-partial-title", text: "Partial report" }),
      h("p", { text: "We found useful information, but some specifications or current product data could not be fully verified." })
    ])]);
  }

  root.RFProduct = { renderEmpty: renderEmpty, renderResearching: renderResearching, renderReport: renderReport, TABS: TABS };
})(window);
