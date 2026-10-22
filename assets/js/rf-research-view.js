/*
 * Product Intelligence pane for ItemAssist Research. It renders a research response in the same pane, tabs and design language as
 * the replacement report (rf-ph header, rf-tabbar, rf-block, rf-lead, rf-pill), but from the research contract: the identified
 * product, what a replacement should match, the successor candidate and the alternatives, with each one's differences, concerns and
 * uncertainty. Every candidate is shown as an unverified suggestion. There is no price, availability or like-kind-and-quality
 * wording here: the response carries none, and this file adds none.
 */
(function (root) {
  "use strict";

  var RF = root.RFShared;
  var D = root.RFDom;
  var R = root.RFReplacement;
  var Research = root.RFResearch;
  var P = root.RFResearchPriceView;
  var h = D.h;

  var TABS = [["overview", "Overview"], ["original", "Original product"], ["requirements", "Requirements"], ["replacements", "Replacements"]];
  // research.2 adds the sourced prices and the valuation's basis as a fifth section; research.1 keeps its four.
  var TABS_V2 = TABS.concat([["pricing", "Pricing & evidence"]]);
  var tabsFor = function (data) { return Research.isV2(data) ? TABS_V2 : TABS; };
  var SOURCE_LABELS = {
    AI_ESTIMATE: "From the AI estimate",
    AI_ESTIMATE_PLUS_CATEGORY_GUIDANCE: "AI estimate plus general guidance",
    CATEGORY_GUIDANCE: "General guidance for this type of item"
  };

  function pane(children, busy) {
    return h("div", { class: "rf-pane-body", attrs: { "aria-busy": busy ? "true" : "false" } }, children);
  }

  /** While a request is running. Accurate to what happens: one AI estimate, no source checking. */
  function renderResearching(query) {
    return pane([h("div", { class: "rf-empty rf-empty--busy", attrs: { role: "status" } }, [
      h("p", { class: "rf-eyebrow", text: "Researching" }),
      D.heading("h3", "rf-researching-h", query || "Your item", "rf-empty-name"),
      h("p", { class: "rf-empty-lede", text: "Identifying the product and preparing replacement research." }),
      h("div", { class: "rf-skeleton", attrs: { "aria-hidden": "true" } }, [h("i", {}), h("i", {}), h("i", {}), h("i", {})])
    ])], true);
  }

  function list(items, className) {
    return h("ul", { class: className || "rf-rs-list" }, items.map(function (text) { return h("li", { text: text }); }));
  }

  function block(id, title, children) {
    return h("section", { class: "rf-block", attrs: { "aria-labelledby": id } }, [D.heading("h3", id, title, "rf-eyebrow rf-sec-label")].concat(children));
  }

  /** Always visible above the tabs: what this result is, in plain words. */
  function banner(data) {
    var title = Research.SUMMARY_TITLE;
    var text = Research.isV2(data) ? Research.SUMMARY_NOTE_V2 : Research.SUMMARY_NOTE;
    if (data.status === "UNAVAILABLE") {
      title = "Research unavailable";
      text = "ItemAssist Research couldn't complete this request. These are general requirements for this type of item, not researched results.";
    } else if (data.status === "GUIDANCE_ONLY") {
      title = "Product not identified";
      text = "The item couldn't be identified from the description, so these are general requirements for this type of item. " + (Research.isV2(data) ? Research.SUMMARY_NOTE_V2 : Research.SUMMARY_NOTE);
    }
    return h("div", { class: "rf-partial rf-rs-banner", attrs: { role: "note" } }, [D.icon("info"), h("div", {}, [h("p", { class: "rf-partial-title", text: title }), h("p", { text: text })])]);
  }

  function headerParts(data) {
    var identified = Boolean(data.original.identity);
    var confidence = identified ? R.confidence(data.original.confidence) : null;
    return [
      h("p", { class: "rf-ph-brand", text: Research.categoryLabel(data.category) + " research" }),
      D.heading("h3", "rf-product-name", identified ? data.original.identity : "Product not identified", "rf-ph-model"),
      h("div", { class: "rf-status-row", attrs: { role: "group", "aria-label": "Research status" } }, [
        // Shown only when the server marked the answer as canned Preview data; the text is fixed here, never taken from the response.
        data.meta && data.meta.fixture === true ? D.pill("info", "info", Research.DEMO_LABEL, "rf-rs-demo") : null,
        D.pill("warn", "q", data.status === "UNAVAILABLE" ? "General guidance only" : (Research.isV2(data) ? "Candidates not verified" : "AI estimate, not verified")),
        confidence
      ].filter(Boolean))
    ];
  }

  function candidateMeta(item) {
    var conditional = item.standing === "CONDITIONAL";
    return h("div", { class: "rf-lead-meta" }, [
      R.confidence(item.confidence),
      item.modelStatus ? D.pill(item.modelStatus === "VERIFIED_LISTING" ? "info" : "warn", item.modelStatus === "VERIFIED_LISTING" ? "check" : "q", Research.label(Research.MODEL_STATUS_LABELS, item.modelStatus, "")) : null,
      item.standing ? D.pill(conditional ? "warn" : "info", conditional ? "q" : "check", conditional ? "Successor, with a caveat" : "Direct successor") : null,
      D.pill("neutral", "q", "Unverified suggestion")
    ].filter(Boolean));
  }

  function differenceLine(item) {
    return item.differences
      ? h("p", { class: "rf-rs-diff" }, [h("strong", { text: "How it differs: " }), item.differences])
      : h("p", { class: "rf-rs-diff rf-rs-diff--none" }, [h("strong", { text: "How it differs: " }), "Not stated. Compare the specifications yourself before choosing."]);
  }

  function concernLine(item) {
    return item.concern ? h("p", { class: "rf-rs-concern" }, [D.icon("info"), h("span", {}, [h("strong", { text: "Concern: " }), item.concern])]) : null;
  }

  function card(item, label, extra) {
    return h("article", { class: "rf-rs-card" }, [
      h("p", { class: "rf-eyebrow rf-rs-card-label", text: label }),
      h("h4", { class: "rf-rs-card-name rf-mono", text: item.name }),
      candidateMeta(item),
      h("p", { class: "rf-rs-why" }, [h("strong", { text: "Why it fits: " }), item.why]),
      differenceLine(item),
      concernLine(item)
    ].concat(extra || []).filter(Boolean));
  }

  function lead(data) {
    if (!data.successor) {
      var many = data.suggestions.length;
      return h("section", { class: "rf-lead rf-lead--none", attrs: { "aria-labelledby": "rf-lead-h" } }, [
        D.heading("h3", "rf-lead-h", "No successor identified", "rf-eyebrow rf-lead-kicker"),
        h("p", { class: "rf-lead-text", text: many ? "I couldn't name the maker's direct successor with confidence. The alternatives below are worth comparing." : "There isn't a candidate to show yet. Add detail in the conversation and I'll research again." })
      ]);
    }
    var item = data.successor;
    return h("section", { class: "rf-lead rf-lead--best", attrs: { "aria-labelledby": "rf-lead-h" } }, [
      D.heading("h3", "rf-lead-h", "Closest successor to consider", "rf-eyebrow rf-lead-kicker"),
      h("p", { class: "rf-lead-name rf-mono", text: item.name }),
      h("p", { class: "rf-lead-text", text: item.why }),
      candidateMeta(item),
      item.differences ? h("p", { class: "rf-lead-note" }, [h("strong", { text: "Biggest difference: " }), item.differences]) : null,
      item.concern ? h("p", { class: "rf-lead-note" }, [h("strong", { text: "Concern: " }), item.concern]) : null
    ].filter(Boolean));
  }

  function toConfirm(data) {
    var items = [];
    if (data.original.uncertainty) items.push(data.original.uncertainty);
    data.clarify.forEach(function (question) { items.push(question + " (answer in the conversation)"); });
    items.push("Specifications, availability and price for any candidate before you buy.");
    return block("rf-confirm-h", "Still to confirm", [list(items)]);
  }

  function overviewPanel(data) {
    var children = Research.isV2(data) ? [P.valuationCard(data), lead(data)] : [lead(data)];
    if (data.suggestions.length) {
      children.push(block("rf-alts-h", "Alternatives to explore (" + data.suggestions.length + ")", [h("ul", { class: "rf-rs-alts" }, data.suggestions.map(function (item) {
        return h("li", {}, [h("span", { class: "rf-rs-alt-name rf-mono", text: item.name }), h("span", { class: "rf-rs-alt-why", text: item.why })]);
      }))]));
    }
    children.push(toConfirm(data));
    return children;
  }

  function originalPanel(data) {
    if (!data.original.identity) return [D.emptyNote("Product not identified", "The item couldn't be identified from the description. Add a brand, model number or key detail in the conversation.")];
    var children = [h("p", { class: "rf-rs-identity", text: data.original.identity }), R.confidence(data.original.confidence)];
    children.push(data.original.characteristics.length ? h("div", {}, [h("p", { class: "rf-rs-sub", text: "Key characteristics" }), list(data.original.characteristics)]) : h("p", { class: "rf-muted", text: "No characteristics were stated." }));
    if (data.original.uncertainty) children.push(h("p", { class: "rf-rs-unsure" }, [h("strong", { text: "Not sure about: " }), data.original.uncertainty]));
    var identified = block("rf-orig-h", "Identified product", children);
    return Research.isV2(data) ? [identified, P.originalPriceBlock(data)] : [identified];
  }

  function requirementsPanel(data) {
    if (Research.isV2(data)) return P.requirementsBlock(data);
    return [block("rf-req-h", "What a replacement should match", [
      D.pill(data.requirementsSource === "AI_ESTIMATE" ? "neutral" : "warn", "q", SOURCE_LABELS[data.requirementsSource] || SOURCE_LABELS.CATEGORY_GUIDANCE),
      h("ol", { class: "rf-rs-reqs" }, data.requirements.map(function (text) { return h("li", { text: text }); }))
    ])];
  }

  function replacementsPanel(data) {
    var cards = [];
    var v2 = Research.isV2(data);
    if (data.successor) cards.push(card(data.successor, "Successor candidate", v2 ? P.candidateDetail(data, data.successor, "SUCCESSOR") : null));
    data.suggestions.forEach(function (item, index) { cards.push(card(item, "Alternative " + (index + 1), v2 ? P.candidateDetail(data, item, "ALT_" + (index + 1)) : null)); });
    if (!cards.length) return [D.emptyNote("No replacement candidates", "No candidates to show yet. Add detail in the conversation and I'll research again.")];
    return [block("rf-cands-h", "Candidates to compare", [
      h("div", { class: "rf-rs-cards" }, cards),
      h("p", { class: "rf-muted", text: v2 ? "These are research candidates, not confirmed equivalents. Each price is labelled with its source, kind and date on the Pricing & evidence tab." : "These are research candidates, not confirmed equivalents. ItemAssist Research doesn't verify availability or price." })
    ])];
  }

  function buildTabs(tabList, onSelect, isNarrow) {
    var tabs = tabList.map(function (entry) {
      return h("button", { class: "rf-tab", text: entry[1], attrs: { id: "rf-rtab-" + entry[0], type: "button", "data-tab": entry[0] } });
    });
    var row = h("div", { class: "rf-tablist" }, tabs);
    row.addEventListener("click", function (event) {
      var target = event.target.closest(".rf-tab");
      if (target) onSelect(target.getAttribute("data-tab"), true);
    });
    row.addEventListener("keydown", function (event) {
      var index = tabs.indexOf(document.activeElement);
      if (index === -1 || isNarrow()) return;
      var next = { ArrowRight: (index + 1) % tabs.length, ArrowLeft: (index + tabs.length - 1) % tabs.length, Home: 0, End: tabs.length - 1 }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      onSelect(tabs[next].getAttribute("data-tab"), true);
    });
    return row;
  }

  /**
   * Wide (two panes): the sections are tabs and one panel shows at a time. Narrow (one continuous page): every section is on the page
   * in order and the tab row is hidden by CSS. Call `syncMode()` when the layout mode changes.
   * @returns {{node: HTMLElement, header: HTMLElement, nameHeading: HTMLElement, reveal: Function, syncMode: Function, currentTab: Function}}
   */
  function renderReport(data, options) {
    var isNarrow = (options && options.isNarrow) || function () { return false; };
    var tabList = tabsFor(data);
    var content = { overview: overviewPanel(data), original: originalPanel(data), requirements: requirementsPanel(data), replacements: replacementsPanel(data) };
    if (Research.isV2(data)) content.pricing = P.pricingPanel(data);
    var panels = {};
    tabList.forEach(function (entry) {
      var panel = h("div", { class: "rf-tabpanel", attrs: { id: "rf-rpanel-" + entry[0], "data-section": entry[0] } }, content[entry[0]]);
      panels[entry[0]] = panel;
    });
    var current = tabList[0][0];
    var row = buildTabs(tabList, function (name) { setTab(name, true); }, isNarrow);
    var tabbar = h("div", { class: "rf-tabbar" }, [row]);
    var header = h("header", { class: "rf-ph" }, headerParts(data));
    var node = h("div", { class: "rf-report rf-report--research" }, [header, banner(data), tabbar].concat(tabList.map(function (entry) { return panels[entry[0]]; })));

    function tabFor(name) { return row.querySelector("#rf-rtab-" + name); }

    function paint() {
      var narrow = isNarrow();
      if (narrow) { row.removeAttribute("role"); row.removeAttribute("aria-label"); } else { row.setAttribute("role", "tablist"); row.setAttribute("aria-label", "Research sections"); }
      tabList.forEach(function (entry) {
        var name = entry[0];
        var active = name === current;
        var tab = tabFor(name);
        var panel = panels[name];
        if (narrow) {
          tab.removeAttribute("role"); tab.removeAttribute("aria-controls"); tab.removeAttribute("aria-selected"); tab.tabIndex = 0;
          panel.setAttribute("role", "group"); panel.setAttribute("aria-label", entry[1]); panel.removeAttribute("aria-labelledby"); panel.tabIndex = -1; panel.hidden = false;
        } else {
          tab.setAttribute("role", "tab"); tab.setAttribute("aria-controls", "rf-rpanel-" + name); tab.setAttribute("aria-selected", active ? "true" : "false"); tab.tabIndex = active ? 0 : -1;
          panel.setAttribute("role", "tabpanel"); panel.setAttribute("aria-labelledby", "rf-rtab-" + name); panel.removeAttribute("aria-label"); panel.tabIndex = 0; panel.hidden = !active;
        }
      });
    }

    function setTab(name, focus) {
      if (!panels[name]) return;
      current = name;
      paint();
      if (isNarrow()) {
        panels[name].scrollIntoView({ block: "start", behavior: "auto" });
      } else if (focus) {
        tabFor(name).focus({ preventScroll: true });
      }
    }

    paint();
    return {
      node: node, header: header, get nameHeading() { return header.querySelector("#rf-product-name"); },
      reveal: function (name) { setTab(name, true); }, syncMode: paint, currentTab: function () { return current; }
    };
  }

  root.RFResearchView = { renderReport: renderReport, renderResearching: renderResearching, TABS: TABS, TABS_V2: TABS_V2 };
})(window);
