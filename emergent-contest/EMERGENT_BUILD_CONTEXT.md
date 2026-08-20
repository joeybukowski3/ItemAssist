# Emergent Build Context

## Product directive

Build a standalone application inspired by Item Assist and optimized around one clear job:

> Enter a discontinued or unavailable product and determine the closest appropriate replacement available today.

This is a real-time Like Kind & Quality (LKQ) replacement calculator and research assistant, not a clone of the production ItemAssist site. Treat this directory as authoritative. Use production files only where this package points to them as legacy examples.

## Primary experience

1. The user enters a model number or product description.
2. The system identifies the original product and makes ambiguity visible.
3. The system reconstructs verified historical specifications.
4. Category rules derive minimum replacement requirements.
5. Research finds plausible, currently available candidates.
6. A deterministic engine gates and scores every candidate.
7. The closest defensible LKQ candidate is selected.
8. The result shows its score, classification, reasoning, differences, observed pricing, sources, and alternatives.
9. An AI research assistant answers questions about the analysis without changing the deterministic result.

The results view should retain rejected and overqualified candidates. Showing why an attractive alternative is not LKQ is part of the product's value.

## Contest MVP

Support these categories:

- televisions
- refrigerators
- AV receivers

**Implement TV first as the reference vertical.** It should demonstrate the complete path from uncertain input through sourced normalization, deterministic scoring, evidence, and follow-up questions. Extend the same contract to refrigerators and AV receivers only after that path is coherent.

Provide instant demo entries such as a Samsung 55-inch television, an LG French-door refrigerator, and a Denon AV receiver. A judge who knows nothing about model numbers should reach a complete, understandable result without typing. The value proposition should be clear in roughly 60 seconds.

## Decision architecture

**AI researches. Rules decide.**

AI may:

- identify a likely product from messy input;
- extract and normalize specifications;
- search for historical evidence and current candidates;
- summarize evidence and explain a completed comparison;
- identify missing facts and propose questions.

Explicit application logic must:

- derive requirements from normalized attributes and category configuration;
- determine candidate eligibility;
- calculate component scores and penalties;
- apply fallback levels and score caps;
- assign classifications and rank candidates;
- produce the same output from the same normalized inputs and configuration.

The LLM must not directly set or revise an LKQ score, eligibility result, fallback level, classification, or rank. If corrected evidence changes normalized input, the deterministic engine may recalculate and the audit trail should show why.

## Trust contract

Never fabricate specifications, prices, availability, model numbers, sources, or citations. Mark unavailable facts `unknown` and unsupported claims `unverified`. Do not silently convert an inference into a confirmed fact.

Pricing and availability are observations, not permanent product attributes. Display their source and observation time, and never imply stale data is current. Historical specifications also require provenance.

Keep two concepts visibly separate:

- **Research/AI confidence** describes certainty in identity, extraction, or evidence.
- **LKQ score** measures deterministic replacement proximity after normalization.

A candidate can have a high LKQ score based on low-confidence inputs; the UI must warn the user rather than disguising that uncertainty. Conversely, a confidently identified candidate may be a poor replacement.

## Product boundaries

Prioritize the replacement workflow. Do not import unrelated ItemAssist concerns such as inbound email, contact forms, age-verification intake, SEO, analytics, privacy-page implementation, or deployment configuration. This context does not define insurance coverage, depreciation, settlement, or payment decisions, and the product should not imply that it does.

## Definition of a persuasive demo

The demo should make this sequence visually obvious:

**Original Product → Replacement Requirements → Best Current Replacement → Score + Classification → Comparison → Alternative Candidates → Research Evidence**

The result should answer four questions immediately: What was identified? What must be preserved? Why did this candidate win? What evidence supports the conclusion?
