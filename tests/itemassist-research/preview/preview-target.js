/**
 * Which origin the hosted-Preview tests may run against. Shared by the Playwright config and the spec, and unit-tested.
 *
 * The tests mock every research and classic API call in the browser, so they never need a backend, Redis or a provider. The guard still
 * refuses anything that is not a *.vercel.app Preview origin, so a mistyped URL can never aim them at a custom production domain.
 * The Deployment Protection bypass secret is read from VERCEL_AUTOMATION_BYPASS_SECRET by the spec only; it is never part of the
 * target, a URL, an error message or a config value.
 */

const LOCAL_PORT = 47233;
// Production aliases of the ItemAssist project. A Preview URL is a per-deployment or per-branch *.vercel.app host, never one of these.
const REFUSED_HOSTS = Object.freeze(["itemassist.vercel.app", "itemassist.com", "www.itemassist.com"]);

function fail(message) {
  throw new Error(`Preview target: ${message}`);
}

/**
 * @param {Record<string, string|undefined>} [env]
 * @returns {{baseURL: string, local: boolean}}
 */
function resolvePreviewTarget(env = process.env) {
  const raw = String(env.PREVIEW_URL || "").trim();
  if (!raw) {
    if (env.PREVIEW_LOCAL === "1") return { baseURL: `http://localhost:${LOCAL_PORT}`, local: true };
    return fail("PREVIEW_URL is not set. Set it to the hosted frontend Preview origin (https://<deployment>.vercel.app), or set PREVIEW_LOCAL=1 for a local self-test.");
  }
  let url;
  try {
    url = new URL(raw);
  } catch (error) {
    return fail("PREVIEW_URL is not a valid URL.");
  }
  if (url.protocol !== "https:") return fail("PREVIEW_URL must use https.");
  if (url.username || url.password) return fail("PREVIEW_URL must not contain credentials.");
  if (url.search || url.hash || url.pathname !== "/") return fail("PREVIEW_URL must be an origin only (no path, query or fragment). A bypass secret never belongs in a URL.");
  const host = url.hostname.toLowerCase();
  if (REFUSED_HOSTS.includes(host)) return fail(`${host} is a production host and is refused.`);
  if (!host.endsWith(".vercel.app")) return fail("PREVIEW_URL must be a *.vercel.app Preview origin; custom domains are refused.");
  return { baseURL: url.origin, local: false };
}

module.exports = { resolvePreviewTarget, LOCAL_PORT, REFUSED_HOSTS };
