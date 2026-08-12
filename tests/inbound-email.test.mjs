import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { Readable } from "node:stream";
import test from "node:test";

const require = createRequire(import.meta.url);
const { createHandler } = require("../api/inbound-email.js");

const SIGNATURE_HEADERS = {
  "svix-id": "msg_test_123",
  "svix-timestamp": "1700000000",
  "svix-signature": "v1,test"
};

function receivedEvent(overrides = {}) {
  return {
    type: "email.received",
    created_at: "2026-08-12T12:00:00.000Z",
    data: {
      email_id: "email_123",
      from: "customer@example.com",
      to: ["support@itemassist.com"],
      subject: "Help with my request",
      ...overrides
    }
  };
}

function createResend({ invalidSignature = false, forwardError = null } = {}) {
  const calls = [];

  return {
    calls,
    webhooks: {
      verify(options) {
        if (invalidSignature) throw new Error("bad signature");
        assert.equal(options.webhookSecret, "whsec_test");
        assert.equal(options.headers.id, SIGNATURE_HEADERS["svix-id"]);
        return JSON.parse(options.payload);
      }
    },
    emails: {
      receiving: {
        async forward(payload, options) {
          calls.push({ payload, options });
          if (forwardError) return { data: null, error: { message: forwardError } };
          return { data: { id: "forwarded_123" }, error: null };
        }
      }
    }
  };
}

function createRequest(event, headers = SIGNATURE_HEADERS) {
  const req = Readable.from([JSON.stringify(event)]);
  req.method = "POST";
  req.headers = headers;
  return req;
}

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end(value = "") {
      this.body += value;
      return this;
    }
  };
}

async function invoke(event, resend) {
  const handler = createHandler({
    resend,
    apiKey: "re_test",
    webhookSecret: "whsec_test",
    logError() {}
  });
  const res = createResponse();
  await handler(createRequest(event), res);
  return { res, body: JSON.parse(res.body) };
}

test("valid support email is forwarded once with passthrough preservation", async () => {
  const resend = createResend();
  const { res, body } = await invoke(receivedEvent(), resend);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(body, { ok: true, forwarded: true, id: "forwarded_123" });
  assert.deepEqual(resend.calls, [
    {
      payload: {
        emailId: "email_123",
        from: "support@itemassist.com",
        to: "joeybuk03@gmail.com",
        passthrough: true
      },
      options: { idempotencyKey: "itemassist-inbound-msg_test_123" }
    }
  ]);
});

test("email for another recipient is acknowledged and ignored", async () => {
  const resend = createResend();
  const { res, body } = await invoke(receivedEvent({ to: ["sales@itemassist.com"] }), resend);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(body, { ok: true, ignored: true });
  assert.equal(resend.calls.length, 0);
});

test("invalid webhook signature is rejected without forwarding", async () => {
  const resend = createResend({ invalidSignature: true });
  const { res, body } = await invoke(receivedEvent(), resend);

  assert.equal(res.statusCode, 400);
  assert.deepEqual(body, { ok: false, error: "Invalid webhook signature." });
  assert.equal(resend.calls.length, 0);
});

test("messages sent by the forwarding addresses are ignored to prevent loops", async () => {
  for (const from of ["support@itemassist.com", "joeybuk03@gmail.com"]) {
    const resend = createResend();
    const { res, body } = await invoke(receivedEvent({ from }), resend);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(body, { ok: true, ignored: true, reason: "forwarding-loop" });
    assert.equal(resend.calls.length, 0);
  }
});

test("forwarding failures return a retryable non-2xx response", async () => {
  const resend = createResend({ forwardError: "temporary failure" });
  const { res, body } = await invoke(receivedEvent(), resend);

  assert.equal(res.statusCode, 502);
  assert.deepEqual(body, { ok: false, error: "Unable to forward inbound email." });
});
