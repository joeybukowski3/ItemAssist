# Research and Evidence

## Research sequence

1. Parse user input without discarding the original text or attachments.
2. Resolve manufacturer, category, model, variant, region, and generation. If multiple identities remain plausible, show them and ask for distinguishing evidence.
3. Reconstruct historical specifications from the strongest available sources.
4. Normalize units, controlled vocabularies, feature aliases, and measurement context while retaining raw values.
5. Derive category requirements from sourced or explicitly user-supplied facts.
6. Search for plausible current candidates and verify that each exact variant exists.
7. Collect candidate specifications, observed price, and availability as separate evidence-backed facts.
8. Pass normalized records to deterministic eligibility and scoring logic.
9. Present the result with citations, observation times, assumptions, unknowns, and conflicts.

## Source priority

Use the strongest source available for each claim:

1. manufacturer product, support, and archive pages;
2. official manuals, specification sheets, installation guides, and catalogs;
3. major authorized retailers for current price and availability;
4. reputable product databases;
5. secondary sources only when stronger evidence is unavailable.

Search snippets are discovery aids, not final evidence. A retailer title alone should not establish a complex technical specification. Marketplaces, forums, and resale listings may help identify legacy products but require lower confidence and corroboration.

## Required evidence

Evidence should support each of the following independently:

- original identity;
- original value-relevant specifications;
- candidate identity and exact variant;
- candidate value-relevant specifications;
- current price;
- current availability.

One URL may support several fields, but citations should be attached at field or claim level. Preserve the page title, publisher, URL, retrieval time, and relevant excerpt or structured value so a reviewer can understand what the source established.

## Evidence states

- `confirmed`: directly supported by an appropriate source.
- `inferred`: derived from evidence but not directly stated; include the inference rule.
- `user_supplied`: provided by the user and not independently verified.
- `unverified`: asserted or discovered but not adequately supported.
- `unknown`: no defensible value is available. Use this when absence is the truth.

These states describe evidence, not LKQ quality. Do not map them to the numeric LKQ score.

## Time-sensitive facts

Price and availability must include `observed_at`, currency, seller, region where material, and a source URL. Prefer a price-status structure such as `confirmed_current`, `stale`, `unavailable`, or `unverified`.

The interface should display “Observed [date/time]” rather than “Current” when freshness cannot be guaranteed. A stale observation can remain in history, but it must not be treated as currently purchasable. Recheck time-sensitive facts when generating or refreshing a result.

Historical specifications are less volatile but still need provenance. Record when a source was retrieved, especially for archived pages that may disappear.

## Conflicts and missing evidence

When sources disagree:

- do not average categorical facts;
- preserve both claims and their sources;
- prefer the more authoritative source only with an explicit resolution reason;
- mark the field unresolved if the conflict cannot be defended;
- prevent unresolved material facts from silently passing a hard requirement.

Category configuration should define how an unknown material requirement behaves. Depending on risk, it may block eligibility, permit a provisional result with a warning, or trigger a lower fallback and score cap. The behavior must be explicit and reproducible.

## Audit trail

Store:

- original user input;
- identity candidates and selected identity;
- raw extracted values and normalized values;
- field provenance and confidence;
- requirement derivation and configuration version;
- candidate search and exclusion reasons;
- scoring input, breakdown, fallback, and output;
- price/availability observation history;
- user corrections and recalculation events.

An explanation should summarize this record, never replace it. Citations must resolve to real sources and must not be invented to make an answer appear complete.
