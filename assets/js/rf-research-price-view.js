/*
 * research.2 panels for the Product Intelligence pane: the valuation range, market tier and price history of the original, the weighted
 * requirements, the per-candidate comparison, and the Pricing & evidence tab. Rendered into the same tabs, blocks and pills as the rest
 * of the report.
 *
 * Every word on these panels comes from a fixed table in rf-research.js, keyed by a code the proxy has already checked; the response
 * supplies codes, numbers, dates and source links, never wording. A price is described by its own kind, verification level and date, so a
 * historical price never reads as a current one and an estimate never reads as confirmed. Only a valuation the proxy marked verified
 * (confirmed current prices) uses the success colour; everything else is amber.
 */
(function (root) {
  "use strict";

  var D = root.RFDom;
  var R = root.RFReplacement;
  var Res = root.RFResearch;
  var h = D.h;

  var SCOPE_LABELS = { EVIDENCE: "Source", PRICE: "Price", TIER: "Market tier", COMPARISON: "Comparison", REQUIREMENT: "Requirement", CANDIDATE: "Candidate" };
  var IMPORTANCE_ORDER = ["ESSENTIAL", "IMPORTANT", "MINOR"];
  var SUBJECT_ORIGINAL = "Original product";
  var ROLE_ORDER = ["USED_IN_RANGE", "CONTEXT_ONLY", "EXCLUDED"];

  function block(id, title, children) {
    return h("section", { class: "rf-block", attrs: { "aria-labelledby": id } }, [D.heading("h3", id, title, "rf-eyebrow rf-sec-label")].concat(children));
  }

  function label(table, key) {
    return Res.label(table, key, "");
  }

  function evidenceOf(data, id) {
    return id ? data.pricing.evidence.filter(function (entry) { return entry.id === id; })[0] || null : null;
  }

  function sourceLink(data, id) {
    var entry = evidenceOf(data, id);
    return entry ? R.sourceLink(entry.sourceUrl, entry.sourceName + " (" + entry.sourceDomain + ")") : null;
  }

  function requirementOf(data, id) {
    return data.requirements.filter(function (item) { return item.id === id; })[0] || null;
  }

  function dateText(price) {
    var day = Res.formatDay(price.asOf);
    return day ? label(Res.DATE_LABELS, price.asOfBasis) + " " + day : label(Res.DATE_LABELS, "UNKNOWN");
  }

  function subjectText(price) {
    if (price.subject === "ORIGINAL") return SUBJECT_ORIGINAL;
    return price.candidate ? label(Res.CANDIDATE_LABELS, price.candidate) : "Replacement (general estimate)";
  }

  function verificationPill(verification) {
    return verification === "VERIFIED_PAGE"
      ? D.pill("ok", "check", label(Res.VERIFICATION_LABELS, verification))
      : D.pill("warn", "q", label(Res.VERIFICATION_LABELS, verification));
  }

  function list(items, className) {
    return h("ul", { class: className || "rf-rs-list" }, items.map(function (text) { return h("li", { text: text }); }));
  }

  /** The valuation range, how it was reached, and every caveat, always together. */
  function valuationCard(data, idSuffix) {
    var headingId = "rf-value" + (idSuffix || "") + "-h";
    var value = data.pricing.valuation;
    var tier = data.pricing.tier;
    var range = Res.formatRange(value.range);
    var asOf = Res.formatDay(value.asOf);
    var pills = [
      D.pill(value.verified ? "ok" : "warn", value.verified ? "check" : "q", label(Res.METHOD_LABELS, value.method)),
      R.confidence(value.confidence),
      asOf ? D.pill("neutral", null, "Prices as of " + asOf) : null
    ].filter(Boolean);
    // The line above already says a listing price is unconfirmed; saying it again as a note only adds noise.
    var notes = value.notes.filter(function (note) { return note.code !== "LISTINGS_NOT_CONFIRMED"; }).map(Res.noteText).filter(Boolean);
    // One confirmed price is an observed anchor for one model, not a range.
    var heading = value.method === "VERIFIED_SINGLE" ? "Replacement price anchor" : "Replacement value range";
    return h("section", { class: "rf-rs-value rf-rs-value--" + (value.verified ? "confirmed" : "estimate"), attrs: { "aria-labelledby": headingId } }, [
      D.heading("h3", headingId, heading, "rf-eyebrow rf-rs-value-kicker"),
      range ? h("p", { class: "rf-rs-range rf-mono", text: range }) : h("p", { class: "rf-rs-range rf-rs-range--none", text: "Not enough evidence to estimate" }),
      h("div", { class: "rf-lead-meta" }, pills),
      h("p", { class: "rf-rs-value-line", text: Res.valuationLine(value) || "" }),
      tier.level !== "UNKNOWN" ? h("p", { class: "rf-rs-tier" }, [h("strong", { text: "Market tier: " }), label(Res.TIER_LABELS, tier.level) + ". " + label(Res.TIER_BASIS_LABELS, tier.basis) + "."]) : null,
      notes.length ? list(notes, "rf-rs-notes") : null,
      data.meta && data.meta.fixture === true ? h("p", { class: "rf-rs-demo-note", text: Res.DEMO_PRICE_NOTE }) : null
    ].filter(Boolean));
  }

  /** The role pill for a price, and the sentence that says why: whether it set the range, is context only, or was left out. */
  function roleLines(data, price) {
    var role = Res.priceRole(data.pricing, price);
    if (!role) return [];
    var why = role.role === "EXCLUDED" ? label(Res.EXCLUSION_LABELS, role.exclusion) : label(Res.PRICE_ROLE_REASONS, role.note);
    var tone = role.role === "USED_IN_RANGE" ? "neutral" : role.role === "EXCLUDED" ? "warn" : "neutral";
    return [
      h("div", { class: "rf-rs-price-role" }, [D.pill(tone, role.role === "EXCLUDED" ? "info" : null, label(Res.PRICE_ROLE_LABELS, role.role))]),
      h("p", { class: "rf-rs-price-why rf-muted", text: why })
    ];
  }

  function priceCard(data, price, className) {
    var amount = Res.formatRange(price.amount);
    var link = sourceLink(data, price.evidenceId);
    var source = evidenceOf(data, price.evidenceId);
    return h("li", { class: "rf-rs-price" + (className ? " " + className : ""), attrs: { "data-price-id": price.id, "data-price-role": (Res.priceRole(data.pricing, price) || {}).role || "" } }, [
      h("div", { class: "rf-rs-price-head" }, [
        D.pill(price.kind === "AI_ESTIMATE" ? "warn" : "neutral", price.kind === "AI_ESTIMATE" ? "q" : null, label(Res.PRICE_KIND_LABELS, price.kind)),
        h("span", { class: "rf-rs-price-amount rf-mono", text: amount || "" })
      ]),
      h("p", { class: "rf-rs-price-meta" }, [subjectText(price) + (price.model ? " · " + price.model : "")]),
      h("div", { class: "rf-rs-price-status" }, [verificationPill(price.verification), h("span", { class: "rf-rs-price-date", text: dateText(price) })]),
      link ? h("p", { class: "rf-rs-price-source" }, [link, source ? " · " + label(Res.SOURCE_CLASS_LABELS, source.sourceClass) + ", " + label(Res.MODEL_RELATION_LABELS, source.modelRelation).toLowerCase() : ""]) : h("p", { class: "rf-rs-price-source rf-muted", text: "No source: this is an estimate." })
    ].concat(roleLines(data, price)));
  }

  /** Original product: market tier and the historical price context. Historical prices are context, never today's retail price. */
  function originalPriceBlock(data) {
    var tier = data.pricing.tier;
    var history = Res.originalPrices(data.pricing);
    var summary = Res.historySummary(data.pricing);
    var children = [];
    children.push(h("p", { class: "rf-rs-tier" }, [h("strong", { text: "Market tier: " }), tier.level === "UNKNOWN" ? "Not determined. The original could not be placed in a tier." : label(Res.TIER_LABELS, tier.level) + ". " + label(Res.TIER_BASIS_LABELS, tier.basis) + "."]));
    if (history.sourced.length) {
      if (summary) children.push(h("p", { class: "rf-rs-value-line", text: summary }));
      children.push(h("ul", { class: "rf-rs-prices" }, history.sourced.map(function (price) { return priceCard(data, price); })));
      children.push(h("p", { class: "rf-muted", text: "A past or list price is context for the original's market tier. It is not today's retail price and it does not set the replacement range." }));
    } else {
      children.push(h("p", { class: "rf-muted", text: "No list or past retail price is included in this research for the original, so there is no sourced price history to show." }));
      if (history.estimate) {
        if (summary) children.push(h("p", { class: "rf-rs-value-line", text: summary }));
        children.push(h("ul", { class: "rf-rs-prices" }, [priceCard(data, history.estimate)]));
      }
    }
    return block("rf-orig-price-h", "Market tier and price history", children);
  }

  /** Weighted criteria, grouped by importance, with where each came from. */
  function requirementsBlock(data) {
    var groups = IMPORTANCE_ORDER.map(function (importance) {
      var items = data.requirements.filter(function (item) { return item.importance === importance; });
      if (!items.length) return null;
      return h("div", { class: "rf-rs-reqgroup rf-rs-reqgroup--" + importance.toLowerCase() }, [
        h("p", { class: "rf-rs-sub", text: label(Res.IMPORTANCE_LABELS, importance) + " (" + items.length + ")" }),
        h("ul", { class: "rf-rs-reqlist" }, items.map(function (item) {
          return h("li", {}, [h("span", { class: "rf-rs-req-text", text: item.text }), item.origin === "AI_ESTIMATE" ? D.pill("warn", "q", label(Res.ORIGIN_LABELS, item.origin)) : null]);
        }))
      ]);
    }).filter(Boolean);
    return [block("rf-req-h", "What a replacement should match", [
      D.pill(data.requirementsSource === "CATEGORY_GUIDANCE" ? "neutral" : "warn", "q", data.requirementsSource === "CATEGORY_GUIDANCE" ? "Standard criteria for this type of item" : "Standard criteria plus AI-added detail"),
      h("p", { class: "rf-muted rf-rs-weight-note", text: "Essential requirements decide eligibility: a candidate that falls short of one is left out of the value range, however good its price. Important and minor ones guide the comparison." })
    ].concat(groups))];
  }

  function statusPill(row) {
    var confirmed = row.basis === "CONFIRMED";
    var text = label(Res.COMPARISON_LABELS, row.status);
    if (row.status === "SHORTFALL") return D.pill(confirmed ? "bad" : "warn", confirmed ? "x" : "q", text);
    if (row.status === "UNKNOWN") return D.pill("neutral", "q", text);
    // Only a requirement confirmed by a cited source gets the success colour; an estimated "meets" is not shown as settled.
    return confirmed ? D.pill("ok", "check", text) : D.pill("neutral", "q", text + " (estimate)");
  }

  function comparisonBlock(data, item) {
    var rows = IMPORTANCE_ORDER.map(function (importance) {
      return data.requirements.filter(function (req) { return req.importance === importance; }).map(function (req) {
        var row = item.comparison.filter(function (entry) { return entry.requirementId === req.id; })[0];
        if (!row && importance !== "ESSENTIAL") return null;
        var link = row && row.evidenceId ? sourceLink(data, row.evidenceId) : null;
        return h("li", { class: "rf-rs-cmp-row" }, [
          h("span", { class: "rf-rs-cmp-text" }, [req.text, h("span", { class: "rf-rs-cmp-imp", text: " " + label(Res.IMPORTANCE_LABELS, req.importance).toLowerCase() })]),
          row ? statusPill(row) : D.pill("neutral", "q", "Not assessed"),
          link ? h("span", { class: "rf-rs-cmp-source" }, [link]) : null
        ].filter(Boolean));
      }).filter(Boolean);
    }).reduce(function (all, group) { return all.concat(group); }, []);
    var essentials = data.requirements.filter(function (req) { return req.importance === "ESSENTIAL"; });
    var count = function (status) { return essentials.filter(function (req) { var row = item.comparison.filter(function (entry) { return entry.requirementId === req.id; })[0]; return (row ? row.status : "UNKNOWN") === status; }).length; };
    var met = count("MEETS") + count("EXCEEDS");
    var summary = essentials.length ? "Essential requirements: " + met + " met, " + count("SHORTFALL") + " short, " + count("UNKNOWN") + " not known." : null;
    return h("div", { class: "rf-rs-cmp" }, [summary ? h("p", { class: "rf-rs-cmp-summary", text: summary }) : null, rows.length ? h("ul", { class: "rf-rs-cmp-list" }, rows) : null].filter(Boolean));
  }

  function candidatePrice(data, key) {
    var prices = data.pricing.prices.filter(function (price) { return price.candidate === key; });
    var current = prices.filter(function (price) { return price.kind === "CURRENT_RETAIL_NEW"; })[0] || prices[0];
    return current ? h("ul", { class: "rf-rs-prices rf-rs-prices--inline" }, [priceCard(data, current)]) : h("p", { class: "rf-muted", text: "No price for this candidate is included in this research." });
  }

  /** The extra lines a candidate card carries in research.2: its price, any exclusion, and the requirement-by-requirement comparison. */
  function candidateDetail(data, item, key) {
    var excluded = data.pricing.valuation.excluded.filter(function (row) { return row.candidate === key; })[0];
    return [
      candidatePrice(data, key),
      excluded ? h("p", { class: "rf-rs-excluded" }, [D.icon("info"), h("span", { text: label(Res.EXCLUSION_LABELS, excluded.reason) })]) : null,
      comparisonBlock(data, item)
    ].filter(Boolean);
  }

  function rejectionLines(data) {
    return data.pricing.rejections.map(function (row) {
      var reason = label(Res.REJECTION_REASON_LABELS, row.reason);
      return label(Res.REJECTION_ACTION_LABELS, row.action) + " (" + (SCOPE_LABELS[row.scope] || "Item").toLowerCase() + ", " + row.count + (row.count === 1 ? " item" : " items") + "): " + (reason || "an entry that could not be used");
    });
  }

  /** One sentence tying the price list to the figure on the Overview, so the two can be checked against each other. */
  function reconcileSummary(pricing, groups) {
    var total = pricing.prices.length;
    if (!total) return null;
    var used = groups.USED_IN_RANGE.length;
    if (used) return used + " of " + total + (total === 1 ? " price" : " prices") + (used === 1 ? " sets" : " set") + " the figure above. The rest are context only or were left out, with the reason shown on each.";
    return "No price here sets a figure. " + (pricing.valuation.range ? "The figure above is an estimate." : "There is not enough evidence for a figure.");
  }

  /** The Pricing & evidence tab: every price with its kind, verification and date, the sources behind them, and what was set aside. */
  function pricingPanel(data) {
    var pricing = data.pricing;
    var children = [valuationCard(data, "-pricing")];
    var groups = Res.pricesByRole(pricing);
    var total = pricing.prices.length;
    var groupBlocks = ROLE_ORDER.map(function (role) {
      var items = groups[role];
      if (!items.length) return null;
      return h("div", { class: "rf-rs-pricegroup rf-rs-pricegroup--" + role.toLowerCase().replace(/_/g, "-") }, [
        h("p", { class: "rf-rs-sub", text: label(Res.PRICE_ROLE_LABELS, role) + " (" + items.length + ")" }),
        h("ul", { class: "rf-rs-prices" }, items.map(function (price) { return priceCard(data, price); }))
      ]);
    }).filter(Boolean);
    var used = groups.USED_IN_RANGE.length;
    var summary = reconcileSummary(pricing, groups);
    children.push(block("rf-prices-h", "Prices in this research (" + total + ")", [
      summary ? h("p", { class: "rf-rs-reconcile", text: summary }) : null,
      total ? h("div", { class: "rf-rs-pricegroups" }, groupBlocks) : h("p", { class: "rf-muted", text: "No prices are included in this research, so nothing here is a price. Any figure on the Overview is labelled as an estimate." }),
      h("p", { class: "rf-muted", text: "Each price is labelled with its kind and date. A past price is never shown as a current one, and an estimate never shows a source." })
    ].filter(Boolean)));
    children.push(block("rf-sources-h", "Sources (" + pricing.evidence.length + ")", [
      pricing.evidence.length ? h("ul", { class: "rf-rs-sources" }, pricing.evidence.map(function (entry) {
        var seen = entry.observedAt ? "Seen " + Res.formatDay(entry.observedAt) : entry.publishedAt ? "Published " + Res.formatDay(entry.publishedAt) : "Date not stated";
        return h("li", {}, [
          h("span", { class: "rf-rs-source-name" }, [R.sourceLink(entry.sourceUrl, entry.sourceName + " (" + entry.sourceDomain + ")")]),
          h("span", { class: "rf-rs-source-meta", text: label(Res.SOURCE_CLASS_LABELS, entry.sourceClass) + " · " + (entry.subject === "ORIGINAL" ? SUBJECT_ORIGINAL : label(Res.CANDIDATE_LABELS, entry.subject)) + " · " + seen + " · " + label(Res.MODEL_RELATION_LABELS, entry.modelRelation) })
        ]);
      })) : h("p", { class: "rf-muted", text: "No sources were cited." }),
      h("p", { class: "rf-muted", text: "Links open the source in a new tab. A link shows where a figure came from; confirm availability and price with the seller." + (pricing.evidence.some(function (entry) { return /^https:\/\/[^/]+\/$/.test(entry.sourceUrl); }) ? " A listing's source links to the seller's site, not to a product page." : "") })
    ]));
    var rejected = rejectionLines(data);
    if (rejected.length) children.push(block("rf-rejected-h", "Set aside", [list(rejected), h("p", { class: "rf-muted", text: "These were removed before anything was shown, so they do not affect the range." })]));
    return children;
  }

  root.RFResearchPriceView = {
    valuationCard: valuationCard, originalPriceBlock: originalPriceBlock, requirementsBlock: requirementsBlock, candidateDetail: candidateDetail, pricingPanel: pricingPanel,
    requirementOf: requirementOf
  };
})(window);
