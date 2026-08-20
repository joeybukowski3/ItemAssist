# Television Category Rules

TV is the first fully implemented vertical slice. It should prove the complete evidence, normalization, gating, scoring, fallback, and explanation workflow before other categories are expanded.

## Relevant attributes

- screen size
- resolution
- display technology
- backlight technology
- smart functionality
- smart platform
- native refresh rate
- HDR formats and performance tier
- HDMI capabilities
- HDMI port count where materially relevant
- tuner
- audio capabilities
- generation-relative product positioning

Retain panel/display technology separately from backlight technology. “LED,” “QLED,” “Mini-LED,” “OLED,” and “QD-OLED” are not a single linear quality scale. Marketing refresh claims must not be normalized as native panel refresh without evidence.

## Requirement derivation

Typical Level 0 requirements include:

- diagonal size meets or exceeds the original within configured measurement tolerance;
- resolution meets or exceeds the original;
- smart functionality is retained when the original had it and it remains relevant;
- display technology is in an allowed equivalency class;
- user-declared material connectivity, tuner, or audio behavior is preserved.

Screen-size proximity still matters after the minimum gate. Bigger is not automatically better. A large jump should lower proximity and may contribute to `ABOVE LKQ`.

Do not make every HDMI-generation improvement a required upgrade. Preserve the original's relevant capability, plus explicit present-day requirements supplied by the user (for example, a required eARC connection). Port count is material when the original installation or stated use depends on it.

## Technology equivalency

- OLED and QD-OLED should generally be compared with premium emissive-display products of comparable positioning.
- Mini-LED may be an acceptable substitution depending on the original performance class and fallback level, but it is not automatically identical to OLED.
- Conventional LED/QLED should not outrank an equivalent original OLED merely because it is newer or uses brighter marketing language.
- Mainstream conventional LED products should generally be compared within similar current positioning before premium display classes are considered.
- Plasma and other extinct technologies require an explicit fallback. Map performance and positioning characteristics, record the substituted class, and cap the result as configured.

Equivalency maps must be versioned and direction-aware. An allowed plasma-to-OLED fallback does not imply that every OLED-to-LED comparison is acceptable.

## Proximity dimensions

Conceptual dimensions include:

- diagonal distance, with asymmetric treatment of deficits and oversize;
- resolution class;
- display/backlight equivalency;
- native refresh and motion class;
- smart capability/platform continuity where relevant;
- HDR class rather than mere presence of an HDR logo;
- material HDMI/tuner/audio features;
- series and market positioning.

Routine generational gains such as a newer smart-platform version should not be penalized heavily when unavoidable. Large gains in size, premium display class, refresh capability, or flagship positioning may trigger overshoot.

## Fallback examples

1. Adjacent current technology within the same size and positioning band.
2. Controlled extinct-technology substitution that preserves relevant performance class.
3. Next-nearest size only when same-size products are genuinely unavailable, with the relaxation and direction shown.
4. Best available exception with failed requirements visible; do not call it a match.

## Explanation checklist

Show the original and candidate side-by-side, the technology-equivalency rule used, size difference, requirement results, positioning evidence, component score, overshoot penalty, fallback, source status, and observation time. Keep research confidence separate from the LKQ score.
