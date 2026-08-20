# ItemAssist Design Notes for the Contest App

These notes extract useful presentation principles from the production site, `DESIGN.md`, and the three copied reference pages. They are references for professional research presentation—not instructions to clone ItemAssist. The contest application should be visually distinct and purpose-built for interactive LKQ analysis.

## What to carry forward

- **Professional research presentation:** neutral language, restrained color, legible typography, and a clear distinction between conclusions and caveats.
- **Evidence display:** show sources, price dates, confidence states, assumptions, and limitations close to the claims they support.
- **Comparison hierarchy:** place original and selected replacement side-by-side, then expose relevant specification rows and meaningful differences.
- **Compact information density:** the report examples fit identity, specifications, price, retailer, and status into a scannable view, with detail available on demand.
- **Trust and verification cues:** source-backed facts, dated observations, verified/estimated labels, and explicit boundaries make the conclusion reviewable.
- **Visible reasoning:** the LKQ and AV pages show why superficially similar products can be under-matches, closer comparables, or premium over-matches.

The site reinforces a useful sequence: identify the item, research age/specifications, compare current products, then document price, source, assumptions, and confidence. The contest app should adapt this sequence to real-time interaction and deterministic scoring.

## Contest-specific visual hierarchy

The primary page structure should be:

**Original Product → Replacement Requirements → Best Current Replacement → Score + Classification → Comparison → Alternative Candidates → Research Evidence**

Lead with a compact answer area rather than a large marketing hero. Make the winning candidate and its eligibility state visible alongside the original. A reviewer should then be able to inspect the requirement gate, score components, penalties, fallback, and citations without losing context.

Keep AI research confidence separate from the LKQ score visually and semantically. For example, an “Identity confidence: medium” evidence badge should not resemble an “LKQ: 82/100” decision gauge.

## Status system

Use status colors consistently and pair color with text/iconography:

- Match: green
- Close Match: blue or teal
- Above LKQ: amber
- Not LKQ: red

Reserve these colors for decision meaning. Use neutral treatments for evidence statuses such as confirmed, inferred, user supplied, unverified, or unknown so the two systems are not conflated.

## Layout and interaction

- Use a strong grid and compact comparison table for repeated attributes.
- Keep the original and winner visible while inspecting alternatives when practical.
- Collapse low-priority evidence detail, but never hide failed requirements or fallback disclosures.
- Make source links and observation times easy to scan.
- Use restrained borders, whitespace, and subtle surfaces instead of heavy shadows.
- Design responsive comparison rows that remain understandable on mobile.
- Provide accessible labels and icons in addition to color.
- Allow an AI assistant in a secondary panel or follow-up area; do not let chat dominate the core workflow.

## Avoid

- generic chatbot landing pages;
- excessive glassmorphism;
- giant empty hero sections;
- generic AI gradients;
- unnecessary cards around every field;
- decorative visuals that obscure comparison logic;
- a single opaque score without component evidence;
- treating a high-confidence extraction badge as an LKQ result.

The desired character is professional research software: analytical, trustworthy, compact but readable, and high in useful information density.

## Instant contest demo

Offer one-click examples on the homepage, such as a Samsung 55-inch television, LG French-door refrigerator, and Denon AV receiver. Use scenario labels that explain the challenge (“mainstream TV vs premium overshoot”), not only model numbers. A judge should be able to launch a pre-researched example and understand the complete value in about 60 seconds.

The demo should reveal at least one rejected candidate and one `ABOVE LKQ` candidate. That contrast makes “AI researches; deterministic rules decide” tangible faster than a generic assistant conversation.

## Reference files

- [ItemAssist LKQ page](itemassist-lkq-page.html): comparison education, refrigerator example, and documentation cues.
- [ItemAssist AV receiver research](itemassist-av-receiver-research.html): dense domain explanation, capability hierarchy, and under/strong/over-match framing.
- [ItemAssist sample report](itemassist-report.html): compact report structure, original-versus-replacement detail, and confidence/source presentation.
- Repository `DESIGN.md`: typography, restrained borders, hierarchy, responsive behavior, and high-trust visual tone. Its atmospheric marketing guidance is less relevant than its clarity and component discipline.
