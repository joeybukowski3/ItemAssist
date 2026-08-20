# Emergent LKQ Contest Reference Package

This directory is the authoritative context for the Emergent AI builder-contest application. Production ItemAssist files elsewhere in the repository are secondary references only; do not infer contest requirements from unrelated production systems.

## Read in this order

1. [EMERGENT_BUILD_CONTEXT.md](EMERGENT_BUILD_CONTEXT.md)
2. [PRODUCT_VISION.md](PRODUCT_VISION.md)
3. [LKQ_SCORING.md](LKQ_SCORING.md)
4. [PRODUCT_SCHEMA.md](PRODUCT_SCHEMA.md)
5. [BENCHMARK_CASES.md](BENCHMARK_CASES.md)
6. [RESEARCH_AND_EVIDENCE.md](RESEARCH_AND_EVIDENCE.md)
7. Category guides: [TV](categories/TV.md), [refrigerator](categories/REFRIGERATOR.md), and [AV receiver](categories/AV_RECEIVER.md)
8. Illustrative JSON: [TV](examples/tv-example.json), [refrigerator](examples/refrigerator-example.json), and [AV receiver](examples/av-receiver-example.json)
9. Legacy ItemAssist references in [reference/](reference/)

## Contest priorities

The MVP categories are TVs, refrigerators, and AV receivers. Implement TV first as the complete reference vertical slice. A deep, reproducible, evidence-backed TV workflow is more valuable than shallow support for many categories.

The package defines the product and its decision contract, not application code. Its governing principle is: **AI researches. Deterministic rules decide.** Quality and auditability take precedence over breadth.
