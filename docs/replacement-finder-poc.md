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

`api/lib/replacement-finder/projection.js` copies known fields one by one. Unknown keys at any level are dropped; enumerations are
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

## Page behaviour

- **Form:** category (radio group), fixed supported brand, model, optional notes. Client validation mirrors the proxy's rules.
- **Loading:** a staged list (Identifying original product, Verifying specifications, Evaluating current models, Comparing
  requirements, Selecting best replacement) with "This may take up to about 20 seconds." It is a UI sequence describing the work, not
  live server state. A Cancel button aborts the request.
- **Complete / Partial:** Original Product, Recommended Replacement, Match Summary (above the comparison), Side-by-Side Comparison,
  Before Finalizing, Alternatives (max 2), Sources. Partial adds a "Partial Recommendation" banner and keeps every usable section.
- **Best available:** when `primary.isBestAvailableOnly` is true the primary is titled "Best Available Option Found", is not styled
  as a normal recommendation, and states that it does not fully satisfy LKQ requirements.
- **No result / Unsupported / Error:** calm, specific states. Unsupported lists the supported categories and lets the user switch.
- **Confidence** is categorical (High / Medium / Low). There is no percentage anywhere.
- **Safe rendering:** every API string goes through `textContent`; there is no `innerHTML`.
- **Accessibility:** labelled fields, `fieldset`/`legend`, `aria-live` results region, focus moved to the loading/result/error heading,
  an `alert` error summary, visible focus styles, and status always shown as text alongside colour and an icon.

## Tests

All offline. Nothing contacts the engine or any provider.

```
npm run test:replacement-finder        # unit + endpoint (node --test)
npm run test:e2e:replacement-finder    # Playwright at 375 / 768 / 1280
```

The Playwright suite reuses the repository's analytics-blocking fixture (`tests/request-intake/e2e/fixtures.js`) and static server.
It mocks `/api/replacement-finder` with `page.route`. To capture screenshots for visual review (written outside the repo):

```
RF_SCREENSHOT_DIR=/some/dir npx playwright test --config=tests/replacement-finder/e2e/playwright.config.js screenshots.spec.js
```

The suite listens on port 47231 by default (override with `RF_STATIC_SERVER_PORT`).
