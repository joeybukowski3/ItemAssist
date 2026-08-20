# Benchmark Cases

## Purpose

The scoring system should be calibrated against human-reviewed ranking behavior, not tuned to make one favorite example score well. Each benchmark eventually needs a verified original, an appropriate replacement, an acceptable alternative, a misleading “better” candidate, an unacceptable candidate, and a written rationale.

Cases below are **conceptual benchmarks**, not claims about live models, prices, or availability. Placeholder candidate labels describe controlled attribute bundles. Replace them with exact, sourced products only after market research and human review.

For early calibration, assert relative rank, gate behavior, fallback, and classification before asserting exact numeric scores. Once sufficient reviewed cases exist, freeze expected score ranges and configuration versions.

## TV scenarios

### TV-01 — Older mainstream LED to current mainstream LED

**Original:** 55-inch, 4K, smart, conventional LED/LCD, 60 Hz, mainstream series.

**Candidates:**

- A: current 55-inch 4K smart conventional LED, 60 Hz, mainstream series.
- B: current 55-inch 4K smart LED, entry series with fewer materially required connections.
- C: current 65-inch premium OLED with higher refresh rate and premium HDR capability.
- D: current 50-inch 4K smart LED, otherwise similar.

**Expected behavior:** A ranks first and should be `MATCH` if evidence is complete. B is lower or fails if the missing connectivity is a material requirement. C is `ABOVE LKQ`, not the winner; size, technology, and positioning overshoot are explicit. D fails the normal size gate and is `NOT LKQ` unless a documented fallback permits a smaller set.

**Tests:** proximity over superiority; hard size gate; entry-tier under-match; overshoot classification.

### TV-02 — Extinct plasma technology

**Original:** 60-inch, 1080p plasma, non-smart or early-smart, strong motion and black-level characteristics, upper-midrange in its generation.

**Candidates:**

- A: same-size current OLED in a comparable upper-midrange position.
- B: same-size high-performance Mini-LED in a comparable position.
- C: same-size entry conventional LED.
- D: larger flagship emissive display.

**Expected behavior:** no candidate passes a literal technology match, so the engine invokes an explicit extinct-technology fallback. A and possibly B become controlled substitutes based on the configured performance-equivalency map; the UI records the technology relaxation and score cap. C should not win merely because it is same-size and current. D should be `ABOVE LKQ` if its size/positioning materially overshoots.

**Tests:** fallback transparency; extinct class mapping; entry under-match; unavoidable modernization versus excessive upgrade.

### TV-03 — Mainstream 55-inch where premium 65-inch looks “better”

**Original:** mainstream 55-inch 4K smart LED.

**Candidates:**

- A: 55-inch current mainstream LED/QLED within the configured technology class.
- B: 65-inch premium OLED.
- C: 55-inch premium OLED.
- D: 55-inch non-smart commercial display.

**Expected behavior:** A ranks first. B is `ABOVE LKQ` with multiple overshoot triggers. C may also be `ABOVE LKQ` despite matching size. D fails smart/function requirements and is `NOT LKQ`. More expensive or more capable must not mean more equivalent.

**Tests:** overshoot decay independent of screen size; functional gate; market positioning.

## Refrigerator scenarios

### RF-01 — French-door installation compatibility

**Original:** three-door French-door, approximately 36-inch width, standard depth, high capacity, dual ice, beverage-center-type internal water feature, mainstream/upper-mainstream position. User supplies a verified cabinet opening.

**Candidates:**

- A: same configuration and feature set, within every installation dimension and close in capacity/position.
- B: same configuration and capacity but too wide or too tall for the verified opening.
- C: fits and has dual ice but lacks the materially relevant beverage feature.
- D: four-door premium model with convertible drawer and materially different premium positioning.

**Expected behavior:** A ranks first. B fails a hard fit requirement and is `NOT LKQ`. C is an under-match or controlled fallback depending on requirement policy. D is `ABOVE LKQ`; added doors and convertible storage should not be treated as pure bonuses.

**Tests:** user-supplied installation constraints; configuration; feature preservation; premium over-match.

### RF-02 — Capacity and dispenser mismatch

**Original:** bottom-freezer, roughly 22 cu. ft., constrained width, external water dispenser absent, single ice maker, mainstream.

**Candidates:**

- A: close-capacity bottom-freezer that fits and preserves dispenser/ice configuration.
- B: much larger full-depth French-door unit with external dispenser that does not fit.
- C: smaller fitting bottom-freezer below the configured minimum functional capacity.
- D: close-capacity fitting bottom-freezer with an unavoidable finish change.

**Expected behavior:** A ranks first. B is `NOT LKQ` because installation and configuration failures dominate capacity. C fails minimum capacity. D can be `CLOSE MATCH` under a bounded finish fallback if equivalent finishes are unavailable; the relaxed attribute is recorded.

**Tests:** “largest wins” failure; hard dimensions; minimum capacity; controlled cosmetic fallback.

## AV receiver scenarios

### AVR-01 — Legacy 7.2 receiver with modern HDMI requirement

**Original:** 7 amplified channels / 7.2 processing, Atmos-class decoding as relevant, multiple HDMI inputs, full required system connections, room correction, networking, and Zone 2; legacy HDMI cannot meet the user's present 4K/eARC requirement.

**Candidates:**

- A: current 7-channel upper-mainstream AVR preserving required system functions and adding the necessary modern HDMI/eARC capability.
- B: current 5-channel receiver marketed with modern HDMI.
- C: current flagship 11-channel AVR with advanced processing, full expansion, and materially higher positioning.
- D: current 7-channel model lacking a materially used Zone 2 or pre-out function.

**Expected behavior:** A ranks first. B fails amplified-channel requirements and is `NOT LKQ`. C is `ABOVE LKQ`; modern capability does not justify flagship overshoot. D fails or becomes a documented fallback only if the missing capability is proven irrelevant to the user's system.

**Tests:** modern requirements layered onto legacy equivalency; amplified versus headline channels; functional preservation; flagship over-match.

### AVR-02 — Same 7.2 label, different architecture

**Original:** premium 7.2-channel receiver with full multichannel pre-outs, advanced room correction, multi-zone support, and strong generation-relative position.

**Candidates:**

- A: upper-midrange current receiver with comparable processing, room correction, pre-outs, and zones.
- B: mainstream 7.2 receiver with no full pre-out array and simpler room correction.
- C: processor plus separate amplification system.
- D: flagship integrated AVR materially beyond the original's channel and processing needs.

**Expected behavior:** A ranks first and is `MATCH` or `CLOSE MATCH` based on verified proximity. B is an under-match even though its label says 7.2. C is a different architecture and normally `NOT LKQ` absent a special system-level requirement. D is `ABOVE LKQ`.

**Tests:** visible similarity versus system capability; architecture gate; product-series position; overshoot.

## Benchmark review protocol

For each sourced production benchmark:

1. two domain reviewers independently identify the expected ordering and requirement failures;
2. disagreements are documented before adjusting rules;
3. rule changes are tested against the entire set, not only the failing case;
4. expected outputs include classification, fallback, and reason codes;
5. evidence snapshots and scoring configuration versions are retained;
6. exact scores are frozen only after weights and thresholds have enough coverage.

Include adversarial variants: missing fields, conflicting sources, regional model suffixes, stale availability, and a high-capability candidate designed to exploit additive scoring.
