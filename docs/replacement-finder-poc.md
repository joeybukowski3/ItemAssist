# Replacement Finder (proof of concept)

A standalone page, `/replacement-finder`, and a same-origin proxy, `POST /api/replacement-finder`. The page helps a user find the
closest like-kind-and-quality (LKQ) replacement for a supported product. It is a proof of concept: it is `noindex`, is not linked
from the site navigation, and is not in `sitemap.xml`.

Supported today: **Samsung televisions** and **LG refrigerators**. Nothing else is implied.

## Request flow

```
Browser (replacement-finder.js)
  POST /api/replacement-finder            same origin, JSON, no secrets
    -> api/replacement-finder.js          this repo
       POST <engine>/api/itemassist-replacement   server to server, bearer token
         -> serial-decoder replacement engine (deterministic retrieval + LKQ rules)
       <- public contract
    <- re-projected through an allowlist
  <- browser-safe result, rendered with textContent
```

The browser never sees the engine URL or token. The page contains no scoring or LKQ logic: it renders the engine's
classifications, assessments and explanations and counts rows for the Match Summary.

### Proxy order of checks

1. Method: `GET` returns `{ "enabled": true|false }`; `POST` continues; anything else is 405.
2. Feature flag `REPLACEMENT_FINDER_ENABLED=true`, otherwise 503 `API_DISABLED`.
3. JSON body only, size capped (2048 bytes), plain object.
4. Honeypot (`website`): when filled, returns `200 { "ok": true, "message": "Request received." }` (the same reply the other ItemAssist
   forms give) and never calls the limiter or the engine.
5. Validation (category and brand pair, model, notes). See `assets/js/rf-shared.js`, which is shared by the page and the proxy.
6. Engine configuration present (otherwise 503 `SERVICE_UNAVAILABLE`, before any rate-limit spend).
7. Per-IP rate limit, **fails closed**.
8. One engine call (24 s timeout, never retried).
9. Re-projection of the engine response.

### Error vocabulary (what the browser can receive)

| Code | HTTP | Meaning |
|---|---|---|
| `INVALID_REQUEST` | 400 / 413 / 415 / 405 | Bad body, bad field, wrong content type or method |
| `UNSUPPORTED` | 422 | Category or model outside the supported set |
| `RATE_LIMITED` | 429 | Over 5 lookups per 10 minutes for this IP |
| `API_DISABLED` | 503 | Feature flag off |
| `SERVICE_UNAVAILABLE` | 503 | Engine not configured or refusing, or the rate-limit store is unavailable |
| `CAPACITY_REACHED` | 503 | The engine's daily search budget is spent |
| `ENGINE_TIMEOUT` | 504 | The engine did not answer within 24 s |
| `ENGINE_ERROR` | 502 | Anything else that went wrong upstream |

Error bodies are fixed (`contractVersion`, `status`, `errorCode`, `message`, `requestId`). Engine text, stack traces, provider
diagnostics and reason codes are never forwarded.

## Rate limiting

5 requests per 10-minute sliding window per client IP (first `x-forwarded-for` entry), using the existing Upstash pattern with its own
prefix (`itemassist:ratelimit:replacement-finder`). If the limiter store is missing, slow or erroring, the proxy answers
503 `SERVICE_UNAVAILABLE` and makes **no** engine call, so paid provider access is never granted while limiter state is unknown.
An over-limit client gets 429 `RATE_LIMITED`.

## Projection

`api/_lib/replacement-finder/projection.js` copies known fields one by one. Unknown keys at any level are dropped; enumerations are
checked against the shared lists; strings lose control characters and are length capped; lists are capped (12 comparison rows,
2 alternatives, 6 sources, 10 needs-verification items, 10 warnings, 16 facts). Source links must be https, carry no credentials or
port, and be on an accepted host (recomputed from the URL, never taken from a claimed domain). The engine's `refinements` list is not
forwarded.

## Environment variables

Set these in the Vercel project. **Do not commit values.**

| Variable | Purpose |
|---|---|
| `REPLACEMENT_FINDER_ENABLED` | Must be exactly `true` to enable the proxy. Default off. |
| `ITEMASSIST_REPLACEMENT_ENGINE_URL` | Origin of the serial-decoder deployment, e.g. `https://<engine-host>`. `https` only (plain `http` is accepted for `localhost` only). The route `/api/itemassist-replacement` is appended by the proxy. |
| `ITEMASSIST_REPLACEMENT_API_TOKEN` | Shared bearer token. Must equal the engine's `ITEMASSIST_REPLACEMENT_API_TOKEN`. Server side only. |
| `UPSTASH_REDIS_REST_URL` | Existing; required by the rate limiter. |
| `UPSTASH_REDIS_REST_TOKEN` | Existing; required by the rate limiter. |

The engine has its own settings (`ITEMASSIST_REPLACEMENT_API_ENABLED`, `ITEMASSIST_REPLACEMENT_API_TOKEN`, `SERPER_API_KEY`,
`ITEMASSIST_REPLACEMENT_DAILY_SEARCH_LIMIT`); see the serial-decoder repository.

## Workspace UI

`/replacement-finder` is a split-screen research workspace, not a form page. The assistant (left, about 38%) holds the conversation; Product
Intelligence (right, about 62%) holds the structured report.

At 960px and below there is no pane switch: the workspace is one continuous, compact page.

- **Chat** sits on a white surface with a navy accent. After a lookup the conversation folds to one summary card (headline, model, price line,
  No Confirmed LKQ); **View conversation** brings the history back. Errors and the open prompt are never folded.
- **Composer**: a compact bar pinned to the bottom of the screen (safe-area aware via `viewport-fit=cover`), with room reserved at the end
  of the page so nothing sits behind it. The structured prompt still opens inside the conversation.
- **Product Intelligence** starts at a solid navy divider. The identity block, one row of short status chips and a compact sticky jump row
  (Overview, Specs, Replacement, Pricing, Evidence) follow; the row scrolls sideways if it must. Jumps land clear of the bar and the row.
- **Sections** are bordered cards with a category colour. The match summary is a 2x2 grid; comparison rows are dense (name and importance,
  original and replacement inline, assessment pill). Critical warnings stay open under the result. Lower-priority detail (why, needs review,
  alternatives, specifications that are not available, supporting sources, "not available yet") is in native `<details>` disclosures that
  start closed. A provenance warning is described once under Overview and the other sections point to it.
- At tablet widths the first sections use two columns and the comparison is a table.

Above 960px nothing of this applies: real tabs show one panel at a time, the assistant pane is sticky with its own scrolling log, and the
composer is part of that pane. The report is built for the current layout and rebuilt if the layout mode changes.

| File | Role |
|---|---|
| `replacement-finder.html` / `.js` | Shell and controller: request state, the only network call, conversation folding |
| `assets/js/rf-assistant.js` | Conversation log, quick actions, composer, the structured "Find a replacement" prompt, loading stages |
| `assets/js/rf-product.js` | Empty / researching states, report header, five tabs (jump links on the single page), Specifications / Pricing / Evidence panels, wide and compact builders |
| `assets/js/rf-replacement.js` | Result headline, retail evidence, reasons, match summary, comparison, warnings, alternatives |
| `assets/js/rf-dom.js` | `textContent`-only element builders |
| `assets/js/rf-shared.js` | Validation and wording shared with the proxy (headline, assessment and warning vocabulary, price/date formatting) |
| `replacement-finder.css`, `assets/css/rf-product.css` | Shell and assistant; Product panels (container queries: the pane responds to its own width) |

### What the assistant does today

- Quick actions: **Find Replacement** opens a compact structured prompt (category, fixed brand, model, optional notes) inside the
  conversation and submits to the existing proxy. Validation is `RFShared.validateLookup`, unchanged.
- **Verify Specs / Compare Models / Price Item / Why this match?** navigate the report that was already returned (Specifications,
  Replacement, Pricing and Overview tabs). Before a report exists they say plainly that standalone versions are not available yet.
- Free text is not a chat backend. Text such as `Samsung QN55Q80C` only prefills the structured prompt; anything else gets an honest
  "not available yet" reply. The attachment control is a disabled placeholder.

### What the report shows (all from the public contract)

- **Headline** uses the engine's `recommendationLevel`: *Recommended Replacement*, *Best Available Current Replacement*, or, for no
  primary, *No Current Retail Replacement Found* (warning `NO_CURRENT_RETAIL_REPLACEMENT`) / *No Replacement Found*. *No Confirmed LKQ*
  appears only when the engine warned `NO_CONFIRMED_LKQ` or `NO_LKQ_CANDIDATE`. Classification (e.g. Unconfirmed) is shown separately.
- **Retail evidence** (new, available, current, seller, observed price and date) is shown apart from the LKQ classification. Price is an
  observation, never part of a match result. There is no price history and no replacement-cost calculation. An observation time is shown
  only when it is a real ISO-8601 date-time with a zone; otherwise the date is simply omitted (never "Invalid Date", never a guess).
- **Match summary** counts Required / Important / Additional / Needs Review from the comparison rows. No score or percentage.
- **Comparison** statuses: Match or Meets, Exceeds, Differs, Verify, Conflict (text plus icon, never colour alone). Table when the pane is
  wide enough, dense stacked rows when it is not.
- **Provenance**: engine warnings (for example `ORIGINAL_SOURCE_NON_US`) are shown under a plain title in the engine's wording, and facts
  that were inferred or assumed are labelled as such. The UI makes no claim about family lineage because the contract has no field for it.
- **Evidence** is grouped as original, replacement, retail availability and supporting sources, each with its link.

### Contract note

`projection.js` also forwards `primary.retail`, `primary.recommendationLevel`, and the same two fields on alternatives. This is the only
change to the proxy path and it is additive. Every field is copied by name; nothing is spread from the engine object.

- `retail` is dropped entirely (null) unless the engine says new, available and current, from a first-party seller, with a source link that
  is https, has no credentials or port, and is on an accepted host (the host is recomputed from the URL; query and fragment are removed).
- Price must be a positive number under a bound with an ISO currency; it is an observation only.
- `observedAt` is forwarded only if it is a real ISO-8601 date-time with a zone in a plausible year (`RFShared.normalizeObservedAt`),
  exactly as given; anything else becomes null. The browser applies the same check before rendering.
- `statusLabel` is forwarded only if it is a known label (`AVAILABLE NEW`); anything else, including a missing value, becomes the fixed
  neutral `AVAILABILITY OBSERVED`. Raw backend text never reaches the browser, and the label never claims more than the record.
- `recommendationLevel` fails closed: either best-available signal wins, and a missing or garbled signal reads as `BEST_AVAILABLE`.
- An older engine without these fields projects to `retail: null` (the UI then shows no availability claim).

## Tests

All offline. Nothing contacts the engine or any provider.

```
npm run test:replacement-finder        # unit + endpoint (node --test)
npm run test:e2e:replacement-finder    # Playwright at 375 / 390 / 768 / 1024 / 1280; the widths spec also covers 520 / 900 / 960 / 961 / 1000 / 1100
```

The Playwright suite reuses the repository's analytics-blocking fixture (`tests/request-intake/e2e/fixtures.js`) and static server.
It mocks `/api/replacement-finder` with `page.route`; the config refuses to reuse an existing server on its port so a stale server from another worktree cannot serve the wrong page. To capture screenshots for visual review (written outside the repo):

```
RF_SCREENSHOT_DIR=/some/dir npx playwright test --config=tests/replacement-finder/e2e/playwright.config.js screenshots.spec.js
```

The suite listens on port 47231 by default (override with `RF_STATIC_SERVER_PORT`).
