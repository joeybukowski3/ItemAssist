/*
 * Replacement presentation for the ItemAssist workspace: the result headline, retail evidence, reasons, match summary,
 * specification comparison, open questions, warnings and alternatives.
 *
 * Everything shown is taken from the public contract. Result levels, classifications, assessments and retail facts are the
 * engine's; this file only chooses wording, tone and layout. There is no scoring, matching or availability logic here.
 */
(function (root) {
  "use strict";

  var RF = root.RFShared;
  var D = root.RFDom;
  var h = D.h;
  var icon = D.icon;
  var MAX_ALTERNATIVES = 2;
  var CONFIDENCE_RANK = { LOW: 1, MEDIUM: 2, HIGH: 3 };

  function confidence(level) {
    var rank = CONFIDENCE_RANK[level] || 0;
    var bars = [1, 2, 3].map(function (n) { return h("i", { class: n <= rank ? "on" : "", attrs: { "aria-hidden": "true" } }); });
    return h("span", { class: "rf-conf" }, [
      h("span", { class: "rf-conf-bars", attrs: { "aria-hidden": "true" } }, bars),
      h("span", {}, [h("strong", { text: RF.CONFIDENCE_LABELS[level] || "Unknown" }), " Confidence"])
    ]);
  }

  function classPill(classification) {
    var glyph = classification === "UNCONFIRMED" ? "q" : classification === "NOT_LKQ" ? "x" : classification === "ABOVE_LKQ" ? "up" : "check";
    return h("span", { class: "rf-class rf-class--" + classification.toLowerCase() }, [icon(glyph), RF.CLASSIFICATION_LABELS[classification] || ""]);
  }

  function sourceLink(url, label) {
    if (!RF.isSafeSourceUrl(url)) return h("span", { text: label });
    return h("a", { class: "rf-link", attrs: { href: url, target: "_blank", rel: "noopener noreferrer" } }, [label, icon("link")]);
  }

  /** Retail evidence is shown on its own, separate from the LKQ classification. Price is an observation, never a score. */
  function renderRetail(retail, options) {
    var compact = options && options.compact;
    if (!retail) return null;
    var seller = retail.sourceName || retail.sourceDomain || "Seller not named";
    var sellerType = RF.SELLER_TYPE_LABELS[retail.sellerType];
    // The label is the engine's seller name; the link's real domain is shown whenever the name does not already say it.
    var showDomain = retail.sourceDomain && seller.toLowerCase().replace(/[^a-z0-9]/g, "").indexOf(retail.sourceDomain.split(".")[0].replace(/[^a-z0-9]/g, "")) === -1;
    var price = options && options.hidePrice ? null : RF.formatPrice(retail.observedPrice);
    var observed = RF.formatObservedDate(retail.observedAt);
    var flags = [["New", retail.condition === "NEW"], ["Available", retail.purchaseStatus === "AVAILABLE"], ["Current", retail.catalogStatus === "CURRENT"]]
      .filter(function (flag) { return flag[1]; })
      .map(function (flag) { return h("li", {}, [icon("check"), flag[0]]); });
    return h("div", { class: "rf-retail" + (compact ? " rf-retail--compact" : ""), attrs: { role: "group", "aria-label": "Retail availability" } }, [
      h("ul", { class: "rf-retail-flags" }, flags),
      h("p", { class: "rf-retail-seller" }, [sourceLink(retail.sourceUrl, seller), sellerType ? h("span", { text: " · " + sellerType }) : null, showDomain ? h("span", { class: "rf-muted", text: " · " + retail.sourceDomain }) : null]),
      price ? h("p", { class: "rf-retail-price" }, [h("span", { class: "rf-price", text: price }), h("small", { text: observed ? "Observed " + observed : "Observed retail price" })]) : null
    ]);
  }

  function renderNoReplacement(data, head) {
    var blocking = data.warnings.filter(function (warning) { return warning.code === "NO_CURRENT_RETAIL_REPLACEMENT"; })[0];
    return h("section", { class: "rf-lead rf-lead--none", attrs: { "aria-labelledby": "rf-lead-h" } }, [
      D.heading("h3", "rf-lead-h", head.title, "rf-eyebrow rf-lead-kicker"),
      h("p", { class: "rf-lead-text", text: blocking ? blocking.message : "Not enough current product information was available to recommend a model." }),
      h("p", { class: "rf-muted", text: "Everything that could be confirmed about the original product is under Specifications and Evidence." })
    ]);
  }

  /**
   * The headline answer. The title is the engine's result level; "No Confirmed LKQ" is shown only when the engine warned of it.
   * On the single page (`options.compact`) the engine's own explanation is the card's short reason, so Overview does not repeat it below.
   */
  function renderLead(data, options) {
    var head = RF.headlineFor(data);
    if (!data.primary) return renderNoReplacement(data, head);
    var compact = options && options.compact;
    var primary = data.primary;
    var best = head.key === "BEST_AVAILABLE";
    var retail = renderRetail(primary.retail);
    return h("section", { class: "rf-lead " + (best ? "rf-lead--best" : "rf-lead--ok"), attrs: { "aria-labelledby": "rf-lead-h" } }, [
      D.heading("h3", "rf-lead-h", head.title, "rf-eyebrow rf-lead-kicker"),
      h("p", { class: "rf-lead-name rf-mono", text: primary.displayName }),
      retail || h("p", { class: "rf-lead-note" }, [D.pill("warn", "q", "Current retail availability could not be confirmed for this model.")]),
      h("div", { class: "rf-lead-meta" }, [
        confidence(primary.confidence),
        classPill(primary.classification),
        RF.hasNoConfirmedLkq(data) ? D.pill("warn", "info", "No Confirmed LKQ") : null
      ]),
      compact && primary.explanation ? h("p", { class: "rf-why-text rf-lead-reason", text: primary.explanation }) : null
    ]);
  }

  /** Reasons behind the result. On the single page (`options.compact`) they sit in a closed disclosure; the explanation itself is in the lead card. */
  function renderWhy(data, options) {
    if (!data.primary) return null;
    var best = RF.headlineFor(data).key === "BEST_AVAILABLE";
    var title = best ? "Why this remains best available" : "Why ItemAssist selected this";
    var points = RF.whyPoints(data).map(function (point) {
      return h("li", { class: "rf-why-" + point.tone }, [icon(point.tone === "ok" ? "check" : "q"), point.text]);
    });
    if (options && options.compact) {
      if (!points.length) return null;
      return D.disclosure({ id: "rf-why-h", title: title, count: points.length, className: "rf-disc--why" }, [h("ul", { class: "rf-why-list" }, points)]);
    }
    return h("section", { class: "rf-block", attrs: { "aria-labelledby": "rf-why-h" } }, [
      D.heading("h3", "rf-why-h", title, "rf-eyebrow rf-sec-label"),
      data.primary.explanation ? h("p", { class: "rf-why-text", text: data.primary.explanation }) : null,
      points.length ? h("ul", { class: "rf-why-list" }, points) : null
    ]);
  }

  /** Counts for Required / Important / Additional / Needs Review, taken from the comparison rows. No score, no percentage. */
  function renderSummary(data) {
    if (!data.primary || !data.comparison.length) return null;
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
        h("p", { class: "rf-tile-label", text: group.label }),
        h("p", { class: "rf-big" }, [group.met + " / " + group.total, h("small", { text: group.verb })]),
        h("div", { class: "rf-ticks" }, ticks),
        h("p", { class: "rf-tile-cap", text: notes.join(" · ") || "No open items" })
      ]);
    });
    var count = summary.needsVerificationCount;
    tiles.push(h("div", { class: "rf-tile rf-tile--verify" }, [
      h("p", { class: "rf-tile-label", text: "Needs Review" }),
      h("p", { class: "rf-big" }, [String(count), h("small", { text: count === 1 ? "item" : "items" })]),
      h("p", { class: "rf-tile-cap", text: count ? "Listed under Replacement" : "Nothing outstanding" })
    ]));
    return h("section", { class: "rf-block", attrs: { "aria-labelledby": "rf-summary-h" } }, [
      D.heading("h3", "rf-summary-h", "Match summary", "rf-eyebrow rf-sec-label"),
      h("div", { class: "rf-tiles" }, tiles)
    ]);
  }

  /** Provenance and cautions, in the engine's own wording under a plain title. Nothing is hidden or softened. */
  function renderWarnings(data, options) {
    var codes = options && options.codes;
    var items = data.warnings.filter(function (warning) { return !codes || codes.indexOf(warning.code) !== -1; });
    if (!items.length) return null;
    var list = items.map(function (warning) {
      return h("li", { class: "rf-note rf-note--" + warning.severity.toLowerCase(), attrs: { "data-code": warning.code } }, [
        h("p", { class: "rf-note-title" }, [icon("info"), RF.WARNING_TITLES[warning.code] || RF.SEVERITY_LABELS[warning.severity] || "Note"]),
        h("p", { text: warning.message })
      ]);
    });
    if (options && options.bare) return h("ul", { class: "rf-notes" }, list);
    return h("section", { class: "rf-block rf-block--warn", attrs: { "aria-labelledby": "rf-warn-h" } }, [
      D.heading("h3", "rf-warn-h", "Provenance and cautions", "rf-eyebrow rf-sec-label"),
      h("ul", { class: "rf-notes" }, list)
    ]);
  }

  function assessmentPill(row) {
    var look = RF.assessmentDisplay(row);
    return h("span", { class: "rf-pill rf-pill--" + look.tone }, [icon(look.icon), look.label]);
  }

  function valueCell(label, value) {
    return h("td", { attrs: { "data-label": label }, class: value === null ? "rf-unknown" : "" }, [value === null ? "Not available" : value]);
  }

  function importanceTag(importance) {
    var level = { REQUIRED: 3, IMPORTANT: 2, ADDITIONAL: 1 }[importance];
    var dots = [1, 2, 3].map(function (n) { return h("i", { class: n <= level ? "on" : "" }); });
    return h("span", { class: "rf-imp" }, [h("span", { class: "rf-imp-dots", attrs: { "aria-hidden": "true" } }, dots), RF.IMPORTANCE_LABELS[importance]]);
  }

  /** Table at wide widths, stacked cards at narrow ones (the switch is a container query in CSS). */
  function renderComparison(data) {
    if (!data.primary || !data.comparison.length) return null;
    var previous = "";
    var rows = data.comparison.map(function (row) {
      var separated = previous && previous !== row.importance;
      previous = row.importance;
      var tone = RF.assessmentDisplay(row).tone;
      return h("tr", { class: separated ? "rf-sep" : "", attrs: { "data-tone": tone } }, [
        h("th", { attrs: { scope: "row" } }, [h("span", { class: "rf-spec", text: row.label }), importanceTag(row.importance)]),
        valueCell("Original", row.original),
        valueCell("Replacement", row.replacement),
        h("td", { attrs: { "data-label": "Assessment" } }, [assessmentPill(row), row.note ? h("small", { text: row.note }) : null])
      ]);
    });
    var head = ["Specification", "Original", "Replacement", "Assessment"].map(function (label) { return h("th", { text: label, attrs: { scope: "col" } }); });
    return h("section", { class: "rf-block rf-compare", attrs: { "aria-labelledby": "rf-compare-h" } }, [
      D.heading("h3", "rf-compare-h", "Specification comparison", "rf-eyebrow rf-sec-label"),
      h("div", { class: "rf-table-wrap" }, [h("table", { class: "rf-table" }, [
        h("caption", { class: "rf-visually-hidden", text: "Original product compared with the replacement" }),
        h("thead", {}, [h("tr", {}, head)]),
        h("tbody", {}, rows)
      ])])
    ]);
  }

  /** Open questions. On the single page (`options.compact`) a closed disclosure whose preview names what is still unconfirmed. */
  function renderNeeds(data, options) {
    if (!data.needsVerification.length) return null;
    var items = data.needsVerification.map(function (item) {
      return h("li", { class: "rf-need" }, [
        h("p", { class: "rf-need-title" }, [icon("q"), item.label, h("span", { class: "rf-reason", text: RF.REASON_LABELS[item.reason] || "" })]),
        h("p", { text: item.message })
      ]);
    });
    if (options && options.compact) {
      var labels = data.needsVerification.map(function (item) { return item.label; }).join(", ");
      return D.disclosure({ id: "rf-needs-h", title: "Needs review", count: data.needsVerification.length, hint: labels, className: "rf-disc--needs" }, [h("ul", { class: "rf-need-list" }, items)]);
    }
    return h("section", { class: "rf-block", attrs: { "aria-labelledby": "rf-needs-h" } }, [
      D.heading("h3", "rf-needs-h", "Needs review", "rf-eyebrow rf-sec-label"),
      h("p", { class: "rf-muted", text: "These details could not be confirmed from available sources." }),
      h("ul", { class: "rf-need-list" }, items)
    ]);
  }

  function renderAlternatives(data, options) {
    if (!data.primary || !data.alternatives.length) return null;
    var cards = data.alternatives.slice(0, MAX_ALTERNATIVES).map(function (alt) {
      var differences = alt.differences.map(function (text) { return h("li", { text: text }); });
      return h("article", { class: "rf-alt" }, [
        h("p", { class: "rf-alt-role", text: alt.roleLabel || "Alternative" }),
        h("h4", { class: "rf-mono", text: alt.displayName }),
        h("div", { class: "rf-alt-meta" }, [classPill(alt.classification), confidence(alt.confidence)]),
        renderRetail(alt.retail, { compact: true }),
        differences.length ? h("div", {}, [h("p", { class: "rf-alt-role", text: "Main differences" }), h("ul", { class: "rf-alt-diff" }, differences)]) : null
      ]);
    });
    if (options && options.compact) {
      var names = data.alternatives.slice(0, MAX_ALTERNATIVES).map(function (alt) { return alt.displayName; }).join(", ");
      return D.disclosure({ id: "rf-alts-h", title: "Alternatives", count: cards.length, hint: names, className: "rf-disc--alts" }, [h("div", { class: "rf-alts" }, cards)]);
    }
    return h("section", { class: "rf-block", attrs: { "aria-labelledby": "rf-alts-h" } }, [
      D.heading("h3", "rf-alts-h", "Alternatives", "rf-eyebrow rf-sec-label"),
      h("p", { class: "rf-muted", text: "Secondary options, shown for comparison with the primary result." }),
      h("div", { class: "rf-alts" }, cards)
    ]);
  }

  root.RFReplacement = {
    confidence: confidence, classPill: classPill, sourceLink: sourceLink, renderRetail: renderRetail, renderLead: renderLead, renderWhy: renderWhy,
    renderSummary: renderSummary, renderWarnings: renderWarnings, renderComparison: renderComparison, renderNeeds: renderNeeds, renderAlternatives: renderAlternatives
  };
})(window);
