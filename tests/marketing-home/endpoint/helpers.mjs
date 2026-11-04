// Fakes for the consultation endpoint. The Turnstile, rate-limit and request/response fakes are shared with
// the request-intake tests; the email and Redis fakes here cover what the consultation handler needs
// (provider-style email results and SET NX / DEL).
export {
  createFakeRatelimit,
  createFakeTurnstileVerify,
  createFakeReq,
  createFakeRes
} from "../../request-intake/endpoint/helpers.mjs";

/** mode: "ok" resolves, "throw" rejects, "error-result" resolves { data: null, error } the way the Resend SDK reports API errors. */
export function createFakeResend({ mode = "ok" } = {}) {
  const sent = [];
  return {
    sent,
    emails: {
      async send(payload) {
        if (mode === "throw") throw new Error("simulated network failure");
        if (mode === "error-result") return { data: null, error: { message: "simulated provider rejection", name: "validation_error" } };
        sent.push(payload);
        return { data: { id: `fake-${sent.length}` }, error: null };
      }
    }
  };
}

/** SET with { nx }, DEL, and a switch to simulate an unavailable store. */
export function createFakeGuardRedis({ fail = false } = {}) {
  const store = new Map();
  return {
    store,
    async set(key, value, options = {}) {
      if (fail) throw new Error("simulated redis outage");
      if (options.nx && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    },
    async del(key) {
      if (fail) throw new Error("simulated redis outage");
      return store.delete(key) ? 1 : 0;
    }
  };
}

export function validConsultationBody(overrides = {}) {
  return {
    name: "Jane Smith",
    email: "jane@example.com",
    reason: "consultation",
    company: "Smith Adjusting",
    phone: "(555) 555-5555",
    item_count: "11-50",
    description: "About thirty living-room and kitchen items; mostly electronics.",
    submission_id: "sub_0123456789abcdef0123",
    utm_source: "linkedin",
    utm_medium: "social",
    utm_campaign: "launch-nov",
    website: "",
    turnstileToken: "valid-token",
    ...overrides
  };
}

export function minimalConsultationBody(overrides = {}) {
  return { name: "Jane Smith", email: "jane@example.com", reason: "exploring", description: "Just looking at options.", turnstileToken: "valid-token", ...overrides };
}
