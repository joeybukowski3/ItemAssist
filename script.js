/* Nav toggle */
const navToggle = document.querySelector(".nav-toggle");
const siteNav = document.querySelector("#site-nav");

if (navToggle && siteNav) {
  const closeNav = () => {
    siteNav.classList.remove("is-open");
    navToggle.setAttribute("aria-expanded", "false");
    navToggle.setAttribute("aria-label", "Open navigation");
  };

  navToggle.addEventListener("click", () => {
    const isOpen = siteNav.classList.toggle("is-open");
    navToggle.setAttribute("aria-expanded", String(isOpen));
    navToggle.setAttribute("aria-label", isOpen ? "Close navigation" : "Open navigation");
  });

  siteNav.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeNav));
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeNav();
    }
  });
  window.addEventListener("resize", () => {
    if (window.innerWidth > 900) {
      closeNav();
    }
  });
}

/* Active nav link on scroll */
const sections = document.querySelectorAll("section[id], div[id]");
const navLinks = Array.from(document.querySelectorAll(".nav-links a")).filter((link) => {
  try {
    const url = new URL(link.href, window.location.href);
    return url.pathname === window.location.pathname && url.hash;
  } catch {
    return false;
  }
});

if (sections.length && navLinks.length) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        navLinks.forEach((link) => {
          const url = new URL(link.href, window.location.href);
          link.style.color = url.hash === `#${entry.target.id}` ? "#1e3a5f" : "";
        });
      }
    });
  }, { threshold: 0.3 });

  sections.forEach((section) => observer.observe(section));
}

/* Contact form */
const contactForm = document.getElementById("contact-form");

if (contactForm) {
  const submitBtn = contactForm.querySelector(".form-submit");
  const statusEl = document.getElementById("form-status");
  const turnstileContainer = contactForm.querySelector("[data-turnstile-container]");
  const attachmentsInput = contactForm.querySelector('input[name="attachments"]');
  const originalSubmitLabel = submitBtn ? submitBtn.textContent : "Submit Request →";
  const requiredFields = Array.from(contactForm.querySelectorAll("[required]"));
  const maxFileCount = 5;
  const maxFileSizeBytes = 5 * 1024 * 1024;
  const maxTotalFileSizeBytes = 15 * 1024 * 1024;
  const allowedFileExtensions = new Set([
    ".pdf",
    ".xlsx",
    ".xls",
    ".csv",
    ".doc",
    ".docx",
    ".txt",
    ".jpg",
    ".jpeg",
    ".png",
    ".heic",
    ".zip"
  ]);
  let isSubmitting = false;
  let lastSubmissionAt = 0;
  let turnstileWidgetId = null;
  let turnstileReady = false;

  const setStatus = (message, tone = "") => {
    if (!statusEl) {
      return;
    }

    statusEl.className = tone ? `form-status form-status--${tone}` : "form-status";
    statusEl.textContent = message;
  };

  const setSubmittingState = (submitting) => {
    isSubmitting = submitting;
    contactForm.setAttribute("aria-busy", String(submitting));

    if (!submitBtn) {
      return;
    }

    submitBtn.disabled = submitting;
    submitBtn.textContent = submitting ? "Sending..." : originalSubmitLabel;
  };

  const validateField = (field) => {
    const isValid = Boolean(field.value.trim()) && field.checkValidity();
    field.setAttribute("aria-invalid", String(!isValid));
    return isValid;
  };

  const getFileExtension = (filename) => {
    const value = String(filename || "").toLowerCase();
    const index = value.lastIndexOf(".");
    return index >= 0 ? value.slice(index) : "";
  };

  const validateAttachments = () => {
    if (!attachmentsInput || !attachmentsInput.files) {
      return null;
    }

    const files = Array.from(attachmentsInput.files);
    if (files.length === 0) {
      return null;
    }

    if (files.length > maxFileCount) {
      return `Please attach no more than ${maxFileCount} files.`;
    }

    let totalSize = 0;

    for (const file of files) {
      totalSize += file.size;

      if (!allowedFileExtensions.has(getFileExtension(file.name))) {
        return "One or more files use an unsupported format.";
      }

      if (file.size > maxFileSizeBytes) {
        return "Each file must be 5MB or smaller.";
      }
    }

    if (totalSize > maxTotalFileSizeBytes) {
      return "Total attachment size must be 15MB or smaller.";
    }

    return null;
  };

  requiredFields.forEach((field) => {
    field.addEventListener("input", () => {
      if (field.getAttribute("aria-invalid") === "true") {
        validateField(field);
      }
    });
  });

  const renderTurnstile = async () => {
    if (!turnstileContainer || typeof window.turnstile === "undefined" || turnstileReady) {
      return;
    }

    try {
      const response = await fetch("/api/contact", {
        method: "GET",
        headers: { Accept: "application/json" }
      });
      const payload = await response.json();

      if (!response.ok || !payload.turnstileSiteKey) {
        throw new Error(payload.error || "Missing Turnstile site key.");
      }

      turnstileWidgetId = window.turnstile.render(turnstileContainer, {
        sitekey: payload.turnstileSiteKey,
        theme: "light"
      });
      turnstileReady = true;
    } catch {
      setStatus("Spam protection could not load. Refresh the page and try again.", "error");
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

  waitForTurnstile().then(renderTurnstile).catch(() => {
    setStatus("Spam protection could not load. Refresh the page and try again.", "error");
  });

  contactForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (isSubmitting || Date.now() - lastSubmissionAt < 8000) {
      return;
    }

    const invalidFields = requiredFields.filter((field) => !validateField(field));
    if (invalidFields.length > 0) {
      setStatus("Please complete the required fields and try again.", "error");
      invalidFields[0].focus();
      return;
    }

    const attachmentError = validateAttachments();
    if (attachmentError) {
      setStatus(attachmentError, "error");
      if (attachmentsInput) {
        attachmentsInput.focus();
      }
      return;
    }

    if (!turnstileReady || typeof window.turnstile === "undefined") {
      setStatus("Spam protection is still loading. Please wait a moment and try again.", "error");
      return;
    }

    const turnstileToken = window.turnstile.getResponse(turnstileWidgetId);
    if (!turnstileToken) {
      setStatus("Please complete the spam protection check before submitting.", "error");
      return;
    }

    const formData = new FormData(contactForm);
    formData.set("name", String(formData.get("name") || "").trim());
    formData.set("company", String(formData.get("company") || "").trim());
    formData.set("email", String(formData.get("email") || "").trim());
    formData.set("phone", String(formData.get("phone") || "").trim());
    formData.set("client_reference", String(formData.get("client_reference") || "").trim());
    formData.set("item_count", String(formData.get("item_count") || "").trim());
    formData.set("output_format", String(formData.get("output_format") || "").trim());
    formData.set("requested_turnaround", String(formData.get("requested_turnaround") || "").trim());
    formData.set("assignment_notes", String(formData.get("assignment_notes") || "").trim());
    formData.set("subject", String(formData.get("_subject") || "").trim());
    formData.set("website", String(formData.get("website") || "").trim());
    formData.set("turnstileToken", turnstileToken);

    setSubmittingState(true);
    setStatus("Sending your request...", "pending");

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: {
          Accept: "application/json"
        },
        body: formData
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Your request could not be sent. Please try again.");
      }

      contactForm.reset();
      requiredFields.forEach((field) => field.setAttribute("aria-invalid", "false"));
      if (typeof window.turnstile !== "undefined" && turnstileWidgetId !== null) {
        window.turnstile.reset(turnstileWidgetId);
      }
      lastSubmissionAt = Date.now();
      setStatus("Contents list received. We'll review the scope and follow up shortly.", "success");
    } catch (error) {
      setStatus(error.message || "We couldn't send your request. Please try again.", "error");
      if (typeof window.turnstile !== "undefined" && turnstileWidgetId !== null) {
        window.turnstile.reset(turnstileWidgetId);
      }
    } finally {
      setSubmittingState(false);
    }
  });
}

/* Report preview detail rows */
function toggleReportDetail(id, el) {
  const row = document.getElementById(id);

  if (!row || !el) {
    return;
  }

  const isOpen = row.classList.toggle("open");
  el.classList.toggle("open", isOpen);
  el.setAttribute("aria-expanded", String(isOpen));

  const labelNode = Array.from(el.childNodes).find(
    (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0
  );

  if (labelNode) {
    labelNode.textContent = isOpen ? "Hide Specs " : "View Specs ";
  }
}

window.toggleReportDetail = toggleReportDetail;

const publishedDateEls = document.querySelectorAll(".report-published-date");

if (publishedDateEls.length) {
  const today = new Date();
  const options = { year: "numeric", month: "long", day: "numeric" };
  const formatted = `Published ${today.toLocaleDateString("en-US", options)}`;

  publishedDateEls.forEach((el) => {
    el.textContent = formatted;
  });
}
