/* Inquiry form (human-reviewed research, additional or paid access, general question; the older consultation, research
   request and exploring-options types still work). Posts JSON to /api/consultation-request. The server
   repeats every check here and is the authority. Nothing typed into the form is
   stored in the browser; only an explicit campaign tag (utm_source, utm_medium,
   utm_campaign or ref) is kept for the session so it survives moving between pages. */
(() => {
  const form = document.getElementById("consultation-form");

  if (!form) {
    return;
  }

  const ENDPOINT = "/api/consultation-request";
  const SOURCE_KEY = "ia_marketing_source";
  const SOURCE_PARAMS = ["utm_source", "utm_medium", "utm_campaign", "ref"];
  const EMAIL_PATTERN = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]{2,}$/;
  const PHONE_CHARS = /^[0-9+().\-\s#xXeEtT]+$/;
  const RETRY_LOCK_MS = 4000;

  const submitBtn = form.querySelector(".form-submit");
  const statusEl = document.getElementById("consult-status");
  const successEl = document.getElementById("consult-success");
  const heading = document.getElementById("consultation-heading");
  const turnstileContainer = form.querySelector("[data-turnstile-container]");
  const originalLabel = submitBtn ? submitBtn.textContent : "";

  let isSubmitting = false;
  let lastAttemptAt = 0;
  let submissionId = "";
  let turnstileWidgetId = null;
  let turnstileReady = false;

  const field = (id) => document.getElementById(`consult-${id}`);
  const errorEl = (id) => document.getElementById(`consult-${id}-error`);

  // The earlier request types still need a description; the research site's types (human_research, paid_access, general_question) do not.
  // The server (DESCRIPTION_OPTIONAL_REASONS in api/_lib/consultation/validation.js) is the authority. Here the description is only
  // flagged once one of the earlier types is chosen, so an unfinished form never nags about an optional field.
  const DESCRIPTION_REQUIRED_REASONS = ["consultation", "research_request", "exploring"];

  /* Rules mirror api/_lib/consultation/validation.js. A rule whose field is not on this page (item count) is skipped. */
  const RULES = [
    { id: "name", required: "Please enter your name.", check: (v) => (v.length > 100 ? "Please keep your name under 100 characters." : "") },
    {
      id: "email",
      required: "Please enter your email address.",
      check: (v) => (v.length > 254 || !EMAIL_PATTERN.test(v) ? "Please enter a valid email address." : "")
    },
    { id: "reason", required: "Please choose a request type.", check: () => "" },
    { id: "company", check: (v) => (v.length > 120 ? "Please keep the company name under 120 characters." : "") },
    {
      id: "phone",
      check: (v) => {
        const digits = (v.match(/[0-9]/g) || []).length;
        return v && (!PHONE_CHARS.test(v) || digits < 7 || digits > 20 || v.length > 40)
          ? "Please enter a phone number such as (555) 555-5555, or leave it blank."
          : "";
      }
    },
    { id: "count", check: () => "" },
    {
      id: "description",
      required: "Please add a short description of what you need.",
      requiredFor: DESCRIPTION_REQUIRED_REASONS,
      check: (v) => (v.length > 1000 ? "Please keep the description under 1,000 characters." : "")
    }
  ].filter((rule) => field(rule.id));

  const SERVER_FIELD_IDS = { name: "name", email: "email", reason: "reason", company: "company", phone: "phone", item_count: "count", description: "description" };

  const setStatus = (message, tone = "") => {
    if (!statusEl) {
      return;
    }

    const isError = tone === "error";
    statusEl.className = tone ? `form-status form-status--${tone}` : "form-status";
    statusEl.setAttribute("role", isError ? "alert" : "status");
    statusEl.setAttribute("aria-live", isError ? "assertive" : "polite");
    statusEl.textContent = "";
    // The text is set a moment later so assistive technology announces the change.
    window.setTimeout(() => {
      statusEl.textContent = message;
    }, 30);
  };

  const showFieldError = (id, message) => {
    const input = field(id);
    const note = errorEl(id);

    if (!input || !note) {
      return;
    }

    input.setAttribute("aria-invalid", "true");
    note.textContent = message;
    note.hidden = false;
  };

  const clearFieldError = (id) => {
    const input = field(id);
    const note = errorEl(id);

    if (input) {
      input.removeAttribute("aria-invalid");
    }

    if (note) {
      note.textContent = "";
      note.hidden = true;
    }
  };

  const validateField = (rule) => {
    const value = field(rule.id).value.trim();
    const reason = field("reason");
    const waived = Boolean(rule.requiredFor && !(reason && rule.requiredFor.includes(reason.value)));
    const message = !value && rule.required && !waived ? rule.required : rule.check(value);

    if (message) {
      showFieldError(rule.id, message);
    } else {
      clearFieldError(rule.id);
    }

    return message;
  };

  RULES.forEach((rule) => {
    const input = field(rule.id);
    // Re-check a field as it is corrected, so an error clears as soon as it is fixed.
    input.addEventListener("input", () => {
      if (input.getAttribute("aria-invalid") === "true") {
        validateField(rule);
      }
    });
    input.addEventListener("change", () => {
      if (input.getAttribute("aria-invalid") === "true") {
        validateField(rule);
      }

      // Choosing a request type can make the description optional (or required again).
      if (rule.id === "reason") {
        const description = RULES.find((other) => other.id === "description");

        if (description && field("description").getAttribute("aria-invalid") === "true") {
          validateField(description);
        }
      }
    });
  });

  const setSubmitting = (submitting) => {
    isSubmitting = submitting;
    form.setAttribute("aria-busy", String(submitting));

    if (submitBtn) {
      submitBtn.disabled = submitting;
      submitBtn.textContent = submitting ? "Sending..." : originalLabel;
    }
  };

  /* Marketing source: only explicit, short campaign tags, kept for this tab's session. */
  const readSource = () => {
    const fresh = {};

    try {
      const params = new URLSearchParams(window.location.search);
      SOURCE_PARAMS.forEach((key) => {
        const value = (params.get(key) || "").trim().slice(0, 40);
        if (value) {
          fresh[key] = value;
        }
      });
    } catch {
      /* no query string support: no source */
    }

    if (Object.keys(fresh).length > 0) {
      try {
        window.sessionStorage.setItem(SOURCE_KEY, JSON.stringify(fresh));
      } catch {
        /* storage blocked: the tags still go with this page view */
      }
      return fresh;
    }

    try {
      const stored = JSON.parse(window.sessionStorage.getItem(SOURCE_KEY) || "{}");
      return stored && typeof stored === "object" ? stored : {};
    } catch {
      return {};
    }
  };

  // Capture on load so a visitor who arrives tagged and browses on is still attributed.
  readSource();

  const newSubmissionId = () => {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return `sub_${window.crypto.randomUUID()}`;
    }

    const bytes = new Uint8Array(16);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(bytes);
    } else {
      bytes.forEach((_, index) => {
        bytes[index] = Math.floor(Math.random() * 256);
      });
    }
    return `sub_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  };

  /* Turnstile: the site key is public and comes from the same endpoint that verifies the token. */
  const renderTurnstile = async () => {
    if (!turnstileContainer || typeof window.turnstile === "undefined" || turnstileReady) {
      return;
    }

    try {
      const response = await fetch(ENDPOINT, { method: "GET", headers: { Accept: "application/json" } });
      const payload = await response.json();

      if (!response.ok || !payload.turnstileSiteKey) {
        throw new Error("Missing Turnstile site key.");
      }

      turnstileWidgetId = window.turnstile.render(turnstileContainer, { sitekey: payload.turnstileSiteKey, theme: "light" });
      turnstileReady = true;
      form.setAttribute("data-turnstile-ready", "true");
    } catch {
      setStatus("Spam protection could not load. Refresh the page and try again, or email submissions@itemassist.com.", "error");
    }
  };

  const waitForTurnstile = () =>
    new Promise((resolve, reject) => {
      if (typeof window.turnstile !== "undefined") {
        resolve();
        return;
      }

      let attempts = 0;
      const timer = window.setInterval(() => {
        attempts += 1;

        if (typeof window.turnstile !== "undefined") {
          window.clearInterval(timer);
          resolve();
          return;
        }

        if (attempts >= 40) {
          window.clearInterval(timer);
          reject(new Error("Turnstile unavailable"));
        }
      }, 250);
    });

  waitForTurnstile()
    .then(renderTurnstile)
    .catch(() => {
      setStatus("Spam protection could not load. Refresh the page and try again, or email submissions@itemassist.com.", "error");
    });

  const resetTurnstile = () => {
    if (typeof window.turnstile !== "undefined" && turnstileWidgetId !== null) {
      window.turnstile.reset(turnstileWidgetId);
    }
  };

  const showSuccess = () => {
    form.hidden = true;
    successEl.hidden = false;
    successEl.focus();
  };

  const buildPayload = (token) => {
    const source = readSource();
    const payload = {
      name: field("name").value.trim(),
      email: field("email").value.trim(),
      reason: field("reason").value,
      company: field("company").value.trim(),
      phone: field("phone").value.trim(),
      description: field("description").value.trim(),
      website: document.getElementById("consult-website").value.trim(),
      submission_id: submissionId,
      turnstileToken: token
    };

    // The item count only exists on the older form.
    if (field("count")) {
      payload.item_count = field("count").value;
    }

    SOURCE_PARAMS.forEach((key) => {
      if (typeof source[key] === "string" && source[key]) {
        payload[key] = source[key];
      }
    });

    return payload;
  };

  const applyServerErrors = (errors) => {
    let first = null;

    Object.keys(errors || {}).forEach((serverField) => {
      const id = SERVER_FIELD_IDS[serverField];

      if (id && typeof errors[serverField] === "string") {
        showFieldError(id, errors[serverField]);
        first = first || field(id);
      }
    });

    if (first) {
      first.focus();
    }

    return Boolean(first);
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (isSubmitting || Date.now() - lastAttemptAt < RETRY_LOCK_MS) {
      return;
    }

    const failing = RULES.filter((rule) => validateField(rule));
    if (failing.length > 0) {
      setStatus(
        failing.length === 1 ? "Please fix the highlighted field and try again." : "Please fix the highlighted fields and try again.",
        "error"
      );
      field(failing[0].id).focus();
      return;
    }

    if (!turnstileReady || typeof window.turnstile === "undefined") {
      setStatus("Spam protection is still loading. Please wait a moment and try again.", "error");
      return;
    }

    const token = window.turnstile.getResponse(turnstileWidgetId);
    if (!token) {
      setStatus("Please complete the spam protection check before submitting.", "error");
      return;
    }

    // One id per inquiry: a retry after an error reuses it, and the server sends one notification per id.
    submissionId = submissionId || newSubmissionId();
    lastAttemptAt = Date.now();
    setSubmitting(true);
    setStatus("Sending your request...", "pending");

    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(buildPayload(token))
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload.ok) {
        if (payload.errors && applyServerErrors(payload.errors)) {
          setStatus("Please fix the highlighted field and try again.", "error");
        } else {
          setStatus(payload.error || "We couldn't send your request. Please try again, or email submissions@itemassist.com.", "error");
        }
        resetTurnstile();
        return;
      }

      setStatus("", "");
      showSuccess();
    } catch {
      setStatus("We couldn't reach the server. Check your connection and try again, or email submissions@itemassist.com.", "error");
      resetTurnstile();
    } finally {
      setSubmitting(false);
    }
  });

  /* Preselect a request type when a link names one: from another page (?consult=), or by landing on the
     retired #submit-assignment anchor, which now leads to this form as a research request. */
  const selectReason = (wanted) => {
    const select = field("reason");

    if (select && Array.from(select.options).some((option) => option.value && option.value === wanted)) {
      select.value = wanted;
      clearFieldError("reason");
    }
  };

  try {
    selectReason(new URLSearchParams(window.location.search).get("consult"));
  } catch {
    /* no query string support: nothing to preselect */
  }

  const LEGACY_ANCHOR_REASONS = { "#submit-assignment": "research_request" };
  const applyAnchorReason = () => {
    const wanted = LEGACY_ANCHOR_REASONS[window.location.hash];

    if (wanted) {
      selectReason(wanted);
    }
  };

  applyAnchorReason();
  window.addEventListener("hashchange", applyAnchorReason);

  document.querySelectorAll('a[href="#consultation"]').forEach((link) => {
    link.addEventListener("click", () => {
      if (heading) {
        window.setTimeout(() => heading.focus({ preventScroll: true }), 400);
      }
    });
  });
})();
