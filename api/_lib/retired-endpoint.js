/**
 * The handler for an API route that is switched off for the AI-only site (see docs/ai-only-mode.md). It answers every method with
 * 410 Gone and nothing else: it never reads the request body, so no upload is parsed, and it never touches a mailer, store, rate
 * limiter or Turnstile. The route's real implementation stays in its own module (exported as `createHandler` or `legacyHandler`)
 * so the archived commercial site can be restored without rebuilding it.
 */
const RETIRED_MESSAGE = "This service is no longer available.";

function createRetiredHandler() {
  return function retiredHandler(req, res) {
    res.status(410).setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.send(JSON.stringify({ ok: false, error: RETIRED_MESSAGE }));
  };
}

module.exports = { createRetiredHandler, RETIRED_MESSAGE };
