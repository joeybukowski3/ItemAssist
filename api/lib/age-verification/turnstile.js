/**
 * Independently verifies a Cloudflare Turnstile token server-side. Never
 * trust the client-side widget result alone.
 *
 * @param {string} token
 * @param {string} remoteIp
 * @param {{fetchImpl?: typeof fetch, secretKey?: string}} [options] inject fakes in tests
 * @returns {Promise<{success: boolean, [key: string]: any}>}
 */
async function verifyTurnstile(token, remoteIp, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const secretKey = options.secretKey || process.env.TURNSTILE_SECRET_KEY || "";

  const params = new URLSearchParams({
    secret: secretKey,
    response: token || ""
  });

  if (remoteIp) {
    params.set("remoteip", remoteIp);
  }

  const response = await fetchImpl("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params
  });

  return response.json();
}

module.exports = { verifyTurnstile };
