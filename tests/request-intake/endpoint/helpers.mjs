export function createFakeRedis() {
  const store = new Map();
  const sortedSets = new Map();

  return {
    _store: store,
    _sortedSets: sortedSets,
    async set(key, value) {
      store.set(key, value);
      return "OK";
    },
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async zadd(key, entry) {
      const set = sortedSets.get(key) || [];
      set.push(entry);
      sortedSets.set(key, set);
      return 1;
    }
  };
}

export function createFailingRedis(failOn = "set") {
  return {
    async set() {
      if (failOn === "set") {
        throw new Error("simulated redis set failure");
      }
      return "OK";
    },
    async zadd() {
      if (failOn === "zadd") {
        throw new Error("simulated redis zadd failure");
      }
      return 1;
    },
    async get() {
      return null;
    }
  };
}

export function createFakeResend({ failOn = null } = {}) {
  const sent = [];

  return {
    sent,
    emails: {
      async send(payload) {
        const isInternal = payload.subject.startsWith("New Work Order Request");
        const isCustomer = payload.subject.startsWith("Your Item Assist");

        if (failOn === "internal" && isInternal) {
          throw new Error("simulated internal email failure");
        }
        if (failOn === "customer" && isCustomer) {
          throw new Error("simulated customer email failure");
        }

        sent.push(payload);
        return { id: `fake-${sent.length}` };
      }
    }
  };
}

export function createFakeRatelimit({ allow = true } = {}) {
  return {
    calls: [],
    async limit(identifier) {
      this.calls.push(identifier);
      return { success: allow, limit: 5, remaining: allow ? 4 : 0, reset: Date.now() + 600000 };
    }
  };
}

export function createFakeTurnstileVerify({ succeed = true } = {}) {
  const calls = [];
  const fn = async (token, remoteIp) => {
    calls.push({ token, remoteIp });
    return { success: succeed && token === "valid-token" };
  };
  fn.calls = calls;
  return fn;
}

export function createFakeReq({ method = "POST", body = {}, headers = {} } = {}) {
  return {
    method,
    body,
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.5",
      ...headers
    },
    socket: { remoteAddress: "203.0.113.5" }
  };
}

export function createFakeRes() {
  const res = {
    statusCode: null,
    headers: {},
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
    json() {
      return JSON.parse(this.body);
    }
  };
  return res;
}

export function validSubmissionBody(overrides = {}) {
  return {
    full_name: "Jane Smith",
    email: "jane@example.com",
    phone: "555-555-5555",
    customer_type: "homeowner_or_consumer",
    preferred_contact_method: "email",
    company: "",
    requested_services: ["age_verification"],
    information_method: "enter_items_now",
    work_order_description: "Need a supportable age estimate for an insurance claim.",
    universal_ack: true,
    limitations_ack: true,
    website: "",
    turnstileToken: "valid-token",
    item_0_description: "Living room television",
    item_0_category: "Television / Home Electronics",
    item_0_brand: "Sony",
    item_0_model: "XBR-65X900F",
    item_0_serial: "",
    item_0_no_serial: true,
    item_0_notes: "Found in living room, no visible label.",
    ...overrides
  };
}

/**
 * Minimal universal-fields-only submission: no company, no customer type, no
 * preferred contact method, phone omitted (email present), one item with
 * only a description.
 */
export function minimalSubmissionBody(overrides = {}) {
  return {
    full_name: "Jane Smith",
    email: "jane@example.com",
    phone: "",
    customer_type: "",
    preferred_contact_method: "",
    company: "",
    requested_services: ["age_verification"],
    information_method: "enter_items_now",
    work_order_description: "Need a supportable age estimate.",
    universal_ack: true,
    limitations_ack: true,
    website: "",
    turnstileToken: "valid-token",
    item_0_description: "Living room television",
    ...overrides
  };
}
