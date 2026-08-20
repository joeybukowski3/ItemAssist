# LKQ Scoring Framework

This document defines a conceptual, deterministic decision framework. It is intentionally rigorous about behavior but does **not** claim that exact weights or thresholds have been validated. Calibrate them against human-reviewed benchmark cases before production use.

## Decision pipeline

For every original/candidate pair, evaluate in this order:

1. validate that required normalized inputs and scoring configuration exist;
2. apply category eligibility requirements;
3. choose the applicable fallback level, if any;
4. calculate proximity components among candidates allowed at that level;
5. subtract overshoot and other explicit penalties;
6. apply fallback score caps;
7. assign a classification;
8. rank by deterministic tie-break rules.

Do not use price as a shortcut for quality or as the main similarity score. Price and original MSRP can inform market positioning when normalized for category and generation, but observed replacement price is primarily an output.

## 1. Eligibility / requirements gate

Some original attributes create minimum replacement requirements. Each category configuration should declare, per field:

- when the requirement activates;
- whether it is hard, conditional, or soft;
- comparison direction and tolerance;
- how unknown values behave;
- which fallback level may relax it;
- the human-readable failure reason.

Examples for TVs:

- screen size should generally meet or exceed the original, with only configured tolerances;
- resolution should meet or exceed the original;
- smart capability should be preserved when it materially defined the original;
- display technology must be within an acceptable equivalency class;
- materially required ports or functions must be preserved.

A candidate that fails a material requirement cannot rank as a true `MATCH`, even if its weighted average is high. Never let strengths in unrelated dimensions cancel a hard deficit. Record failures as structured reason codes such as `screen_size_below_minimum` or `insufficient_amplified_channels`.

Eligibility can be `PASS`, `FAIL`, or `PROVISIONAL_UNKNOWN`. The last state is for a candidate whose material field cannot yet be verified; configuration must state whether it is excluded or displayed with a capped, provisional result.

## 2. Proximity scoring

Among eligible candidates, reward closeness to the original—not raw superiority. A category may allocate a 100-point pre-penalty score across relevant dimensions such as:

- physical size or installation envelope;
- capacity;
- performance;
- product tier and generation-relative positioning;
- functional features;
- connectivity;
- technology class;
- brand or ecosystem only where materially relevant.

Each component should be a named, pure function of normalized inputs and versioned configuration. Useful function shapes include:

- exact/controlled-class lookup for categorical features;
- bounded distance decay for size or capacity;
- asymmetric distance, where a small deficit is worse than a small surplus;
- set overlap with mandatory and optional feature groups;
- ordinal distance for market position or technology class.

Ignore dimensions that are genuinely irrelevant, but do not silently redistribute their weight when a material value is unknown. Use a documented missing-data policy so two runs behave the same way.

Illustrative component allocation—not a validated production formula:

```text
Eligibility: PASS
Size equivalence: 20/20
Resolution: 15/15
Technology equivalence: 17/20
Functional feature equivalence: 13/15
Market positioning: 12/15
Specification proximity: 9/10
Overshoot adjustment: -4
Final: 82/100
```

## 3. Overshoot decay

A materially superior candidate is not automatically the best LKQ replacement. Overshoot can change cost, positioning, system architecture, installation needs, or the nature of the product.

Model overshoot using explicit rules, for example:

- a continuous penalty beyond a category tolerance;
- a step penalty for an extra technology tier or configuration class;
- a classification override when the candidate materially exceeds the original;
- a score ceiling for candidates with several independent upgrades.

Avoid penalizing unavoidable generational improvements shared by the current market. The penalty should target meaningful distance from the original, not routine modernization.

Example: for an older mainstream 55-inch LED TV, a current mainstream 55-inch LED may be closer than a premium 65-inch OLED. The OLED's extra size, emissive display technology, and premium positioning should not accumulate as bonus points; they should trigger overshoot penalties and likely `ABOVE LKQ`.

## 4. Market positioning

Do not encode permanent universal brand tiers. A manufacturer may sell entry, mainstream, upper-midrange, and flagship products at the same time.

Prefer generation- and category-relative positioning based on evidence such as:

- the model's series position within its manufacturer lineup;
- launch MSRP relative to same-generation peers, adjusted where appropriate;
- specification or capability quantiles within a market cohort;
- manufacturer language and series hierarchy;
- review/database evidence when primary sources are incomplete.

Normalize to an ordinal or continuous positioning value with provenance, for example `entry`, `mainstream`, `upper_midrange`, `premium`, or `flagship`. Treat positioning inference confidence separately from LKQ score. If positioning is unknown, apply the configured missing-data behavior rather than guessing from brand.

## 5. Fallback ladder

When no ideal eligible candidate exists, relax constraints in a category-defined sequence. Never relax several constraints silently in one step.

Conceptual ladder:

- **Level 0 — direct rules:** all material requirements and normal equivalency classes apply.
- **Level 1 — bounded substitution:** allow a documented adjacent class or small dimensional/capacity tolerance.
- **Level 2 — functional preservation:** allow a larger technology or positioning substitution while preserving core function.
- **Level 3 — best available exception:** return the least-deficient researched option with prominent limitations; it is not a true match.

Each level must record:

- the exact constraint relaxed;
- why no candidate passed the prior level;
- the candidates reconsidered;
- a configured maximum score;
- any classification restrictions.

Illustrative policy: Level 1 might cap at `CLOSE MATCH`; Level 2 might cap below `MATCH`; Level 3 would ordinarily be `NOT LKQ` even if it is the best available purchase option. Exact caps require benchmark calibration.

## 6. Classification bands

Numeric thresholds are configuration, not universal truths. Use human-reviewed benchmarks to set them. The semantic classes are:

- **MATCH** — strong LKQ replacement; passes material requirements at an allowed match fallback and remains close in relevant class and positioning.
- **CLOSE MATCH** — generally appropriate, with meaningful documented differences or a bounded fallback.
- **ABOVE LKQ** — meets minimum requirements but materially exceeds the original's relevant class, positioning, configuration, or specifications.
- **NOT LKQ** — fails a meaningful requirement, relies on an unacceptable fallback, or is otherwise inappropriate.

Classification must incorporate gates and overrides, not merely numeric bands. A failing candidate cannot become `MATCH` because optional features inflate a weighted score. An overshooting flagship can be `ABOVE LKQ` even if its raw capability score is high.

Do not hide `NOT LKQ` candidates. Displaying a plausible-looking under-match with its failed requirements teaches why the recommendation is defensible. `ABOVE LKQ` candidates similarly explain why “better” is not synonymous with “closer.”

## 7. Explainability

Every result should expose:

- eligibility state and requirement-by-requirement results;
- component names, possible points, earned points, and input facts;
- penalties and their triggering rules;
- fallback level and relaxed constraints;
- pre-cap score, cap, and final score;
- classification rules or overrides;
- configuration version and scoring time;
- deterministic tie-break outcome.

Generate plain-language explanations from structured results. An LLM may make the explanation readable, but it must not invent a reason absent from the score record.

## 8. Determinism

Given the same normalized original product, candidate data, scoring configuration, and explicit market cohort, output must be reproducible. Version every category rule set and store it with the result.

The LLM may propose normalized values, but only accepted values enter scoring. It may not directly alter eligibility, numeric scores, penalties, fallbacks, classifications, ranking, or tie-breaks.

Define deterministic tie-breakers, for example:

1. higher final score;
2. lower fallback level;
3. lower absolute positioning distance;
4. lower total overshoot penalty;
5. more confirmed material fields;
6. stable candidate ID ordering.

Price should not win a tie unless product policy explicitly calls for it after equivalency is established.

## 9. Calibration and tests

Exact weights, tolerances, thresholds, caps, and equivalency maps must be calibrated against [BENCHMARK_CASES.md](BENCHMARK_CASES.md) and an expanding human-reviewed set. Tests should cover:

- invariance: reruns with identical inputs produce identical output;
- monotonic hard failures: adding optional features cannot erase a requirement failure;
- proximity: bounded superiority does not always increase score;
- overshoot: a materially upgraded product cannot beat a closer equivalent merely by having more features;
- fallback: every relaxation and cap is visible;
- missing data: unknown is never silently treated as favorable;
- classification: semantic overrides take precedence over raw numeric bands.
