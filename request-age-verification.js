/* Page-scoped logic for /request-age-verification. Not part of the shared
 * global script.js — this workflow only exists on this page. */
(function () {
  "use strict";

  var AVShared = window.AVShared;
  var AVFileRules = window.AVFileRules;

  /* ---------- Element lookups + state (must all be assigned before any
   * function below is invoked — several handlers read these eagerly). ---------- */
  var form = document.getElementById("avr-intake-form");
  var referralBanner = document.getElementById("avr-referral-banner");
  var referralCopyEl = document.getElementById("avr-referral-copy");

  var serviceCards = Array.from(document.querySelectorAll("[data-service-option]"));
  var requestedServiceSelect = document.getElementById("avr-requested-service");

  var customerTypeSelect = document.getElementById("avr-customer-type");
  var companyInput = document.getElementById("avr-company");
  var companyOptionalLabel = document.getElementById("avr-company-optional");

  var itemsList = document.getElementById("avr-items-list");
  var addItemButton = document.getElementById("avr-add-item");
  var itemCounter = 0;
  var itemCount = 0;

  var estimateEl = document.getElementById("avr-estimate");

  var errorSummary = document.getElementById("avr-error-summary");
  var errorList = document.getElementById("avr-error-list");

  var turnstileContainer = document.getElementById("avr-turnstile");
  var turnstileWidgetId = null;
  var turnstileReady = false;

  var statusEl = document.getElementById("avr-form-status");
  var submitBtn = document.getElementById("avr-submit-btn");
  var confirmationEl = document.getElementById("avr-confirmation");
  var originalSubmitLabel = submitBtn.textContent;
  var isSubmitting = false;
  var lastSubmissionAt = 0;
  var hasTrackedFormStart = false;

  // Single source of truth lives in AVShared so the DecodeMyItem category
  // mapping can never drift out of sync with these option values.
  var CATEGORY_OPTIONS = AVShared.CATEGORY_OPTIONS;

  var referral = AVShared.parseReferralParams(new URLSearchParams(window.location.search));
  var isReferral = AVShared.isDecodeMyItemReferral(referral);

  /* ---------- Safe analytics wrapper ---------- */
  function track(eventName, props) {
    var safeProps = props || {};

    try {
      window.dispatchEvent(new CustomEvent("itemassist:analytics", { detail: { event: eventName, props: safeProps } }));
    } catch (error) {
      /* CustomEvent should always be available in supported browsers; ignore otherwise. */
    }

    if (typeof window.gtag === "function") {
      window.gtag("event", eventName, safeProps);
    }
  }
  window.AVTrack = track;

  /* ---------- Hidden attribution fields ---------- */
  function addHiddenField(name, value) {
    if (!value) {
      return;
    }
    var input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }

  /* ---------- Service selection ---------- */
  function setSelectedService(service, options) {
    var opts = options || {};
    requestedServiceSelect.value = service;

    serviceCards.forEach((card) => {
      var isSelected = card.getAttribute("data-service-option") === service;
      card.classList.toggle("is-selected", isSelected);
      card.setAttribute("aria-checked", String(isSelected));
    });

    if (!opts.silent) {
      if (service === "age_verification") {
        track("age_verification_selected", { source: referral.source || "direct" });
      } else if (service === "full_valuation") {
        track("full_valuation_selected", { source: referral.source || "direct" });
      }
    }

    updateEstimate();
  }

  /* ---------- Customer type / company requirement ---------- */
  function syncCompanyRequirement() {
    var isProfessional = AVShared.isProfessionalCustomerType(customerTypeSelect.value);
    companyInput.required = isProfessional;
    companyOptionalLabel.style.display = isProfessional ? "none" : "";
  }

  /* ---------- Dynamic item blocks ---------- */
  function buildCategoryOptionsHtml() {
    return (
      '<option value="">Select a category</option>' +
      CATEGORY_OPTIONS.map((label) => `<option value="${label}">${label}</option>`).join("")
    );
  }

  function createItemBlock(index) {
    var wrapper = document.createElement("div");
    wrapper.className = "avr-item-card";
    wrapper.setAttribute("data-item-index", String(index));
    wrapper.innerHTML = `
      <div class="avr-item-card-header">
        <h3>Item <span class="avr-item-number"></span></h3>
        <button type="button" class="avr-remove-item" aria-label="Remove this item">Remove Item</button>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label for="avr-item-${index}-category">Category</label>
          <select id="avr-item-${index}-category" name="item_${index}_category">${buildCategoryOptionsHtml()}</select>
        </div>
        <div class="form-group">
          <label for="avr-item-${index}-brand">Brand</label>
          <input type="text" id="avr-item-${index}-brand" name="item_${index}_brand">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label for="avr-item-${index}-model">Model</label>
          <input type="text" id="avr-item-${index}-model" name="item_${index}_model">
        </div>
        <div class="form-group">
          <label for="avr-item-${index}-serial">Serial number</label>
          <input type="text" id="avr-item-${index}-serial" name="item_${index}_serial" placeholder="Confirm or enter the serial number">
        </div>
      </div>
      <label class="avr-checkbox-row avr-no-serial-row">
        <input type="checkbox" name="item_${index}_no_serial" class="avr-no-serial-checkbox">
        <span>I do not have a readable serial number.</span>
      </label>
      <p class="avr-no-serial-hint">Missing identification may limit the research that can be supported.</p>
      <div class="form-group">
        <label for="avr-item-${index}-notes">Item-specific notes <span class="form-opt">(optional)</span></label>
        <textarea id="avr-item-${index}-notes" name="item_${index}_notes"></textarea>
      </div>
      <div class="form-group">
        <label for="avr-item-${index}-purchase-info">Purchase or installation information <span class="form-opt">(optional)</span></label>
        <input type="text" id="avr-item-${index}-purchase-info" name="item_${index}_purchase_info">
      </div>
      <div class="form-row">
        <div class="form-group form-group--file">
          <label for="avr-item-${index}-label-photo">Data-label photo <span class="avr-recommended">(strongly recommended)</span></label>
          <input type="file" id="avr-item-${index}-label-photo" name="item_${index}_data_label_photo" accept=".jpg,.jpeg,.png,.pdf" class="avr-item-file-input">
        </div>
        <div class="form-group form-group--file">
          <label for="avr-item-${index}-overview-photo">Item overview photo <span class="form-opt">(optional)</span></label>
          <input type="file" id="avr-item-${index}-overview-photo" name="item_${index}_overview_photo" accept=".jpg,.jpeg,.png,.pdf" class="avr-item-file-input">
        </div>
      </div>
    `;

    var noSerialCheckbox = wrapper.querySelector(".avr-no-serial-checkbox");
    var serialInput = wrapper.querySelector(`#avr-item-${index}-serial`);

    noSerialCheckbox.addEventListener("change", () => {
      serialInput.disabled = noSerialCheckbox.checked;
      if (noSerialCheckbox.checked) {
        serialInput.value = "";
      }
    });

    wrapper.querySelector(".avr-remove-item").addEventListener("click", () => {
      removeItem(wrapper, index);
    });

    wrapper.querySelectorAll(".avr-item-file-input").forEach((input) => {
      input.addEventListener("change", updateEstimate);
    });

    return wrapper;
  }

  function renumberItems() {
    var cards = Array.from(itemsList.querySelectorAll(".avr-item-card"));
    cards.forEach((card, position) => {
      card.querySelector(".avr-item-number").textContent = String(position + 1);
      card.querySelector(".avr-remove-item").hidden = cards.length <= 1;
    });
  }

  function addItem() {
    var index = itemCounter;
    itemCounter += 1;
    itemCount += 1;

    var block = createItemBlock(index);
    itemsList.appendChild(block);
    renumberItems();
    updateEstimate();

    track("professional_request_item_added", { item_count: itemCount });

    return block;
  }

  function removeItem(wrapper, index) {
    if (itemsList.querySelectorAll(".avr-item-card").length <= 1) {
      return;
    }

    wrapper.remove();
    itemCount -= 1;
    renumberItems();
    updateEstimate();

    track("professional_request_item_removed", { item_count: itemCount });
  }

  /* ---------- Pricing estimate (planning purposes only) ---------- */
  function updateEstimate() {
    var service = requestedServiceSelect.value;
    var count = Math.max(itemCount, 1);
    var estimate = null;

    if (service === "age_verification") {
      estimate = 25 + count * 10;
    } else if (service === "full_valuation") {
      estimate = count <= 10 ? 75 : 75 + (count - 10) * 10;
    }

    if (estimate === null) {
      estimateEl.textContent = "";
      return;
    }

    estimateEl.textContent = `Estimated at $${estimate} for ${count} item${count === 1 ? "" : "s"}. Estimated pricing for planning purposes only.`;
  }

  /* ---------- Client-side validation ---------- */
  function showErrorSummary(messages) {
    errorList.innerHTML = "";
    messages.forEach((message) => {
      var li = document.createElement("li");
      li.textContent = message;
      errorList.appendChild(li);
    });
    errorSummary.hidden = messages.length === 0;
    if (messages.length > 0) {
      errorSummary.focus();
    }
  }

  function collectFileErrors() {
    var fileInputs = Array.from(form.querySelectorAll('input[type="file"]'));
    var allFiles = [];

    fileInputs.forEach((input) => {
      Array.from(input.files || []).forEach((file) => allFiles.push(file));
    });

    if (allFiles.length === 0) {
      return null;
    }

    return AVFileRules.validateFileSet(allFiles);
  }

  function validateForm() {
    var messages = [];

    var fullName = form.querySelector("#avr-full-name");
    var email = form.querySelector("#avr-email");
    var phone = form.querySelector("#avr-phone");
    var preferredContact = form.querySelector("#avr-preferred-contact");
    var customerType = form.querySelector("#avr-customer-type");
    var requestedService = form.querySelector("#avr-requested-service");
    var reason = form.querySelector("#avr-reason");
    var authorizationAck = form.querySelector("#avr-authorization-ack");
    var limitationsAck = form.querySelector("#avr-limitations-ack");

    if (!fullName.value.trim()) messages.push("Full name is required.");
    if (!email.value.trim() || !email.checkValidity()) messages.push("A valid email address is required.");
    if (!phone.value.trim()) messages.push("Phone number is required.");
    if (!preferredContact.value) messages.push("Please select a preferred contact method.");
    if (!customerType.value) messages.push("Please select what best describes you.");
    if (companyInput.required && !companyInput.value.trim()) messages.push("Company or organization is required for this customer type.");
    if (!requestedService.value) messages.push("Please select the requested service.");
    if (!reason.value.trim()) messages.push("Please describe the reason for the request.");
    if (!authorizationAck.checked) messages.push("Please confirm the authorization statement.");
    if (!limitationsAck.checked) messages.push("Please confirm the service-limitations statement.");

    var itemCards = Array.from(itemsList.querySelectorAll(".avr-item-card"));
    if (itemCards.length === 0) {
      messages.push("At least one item is required.");
    }

    itemCards.forEach((card, position) => {
      var categoryEl = card.querySelector('select[name$="_category"]');
      var serialEl = card.querySelector('input[name$="_serial"]');
      var noSerialEl = card.querySelector(".avr-no-serial-checkbox");

      if (!categoryEl.value) {
        messages.push(`Item ${position + 1}: please select a category.`);
      }
      if (!serialEl.value.trim() && !noSerialEl.checked) {
        messages.push(`Item ${position + 1}: provide a serial number or confirm it has no readable serial number.`);
      }
    });

    var fileError = collectFileErrors();
    if (fileError) {
      messages.push(fileError);
    }

    return messages;
  }

  /* ---------- Turnstile ---------- */
  function waitForTurnstile() {
    return new Promise((resolve, reject) => {
      if (typeof window.turnstile !== "undefined") {
        resolve();
        return;
      }
      var attempts = 0;
      var timer = window.setInterval(() => {
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
  }

  function renderTurnstile() {
    return fetch("/api/age-verification-request", { method: "GET", headers: { Accept: "application/json" } })
      .then((response) => response.json().then((payload) => ({ response, payload })))
      .then(({ response, payload }) => {
        if (!response.ok || !payload.turnstileSiteKey) {
          throw new Error(payload.error || "Missing Turnstile site key.");
        }
        turnstileWidgetId = window.turnstile.render(turnstileContainer, {
          sitekey: payload.turnstileSiteKey,
          theme: "light"
        });
        turnstileReady = true;
      });
  }

  /* ---------- Submission ---------- */
  function setStatus(message, tone) {
    statusEl.className = tone ? `form-status form-status--${tone}` : "form-status";
    statusEl.textContent = message;
  }

  function setSubmittingState(submitting) {
    isSubmitting = submitting;
    form.setAttribute("aria-busy", String(submitting));
    submitBtn.disabled = submitting;
    submitBtn.textContent = submitting ? "Sending..." : originalSubmitLabel;
  }

  function showConfirmation(payload) {
    form.hidden = true;
    document.getElementById("avr-confirm-id").textContent = payload.requestId;
    document.getElementById("avr-confirm-service").textContent =
      { age_verification: "Professional Age Verification", full_valuation: "Full Item Valuation Report", unsure: "Unsure — Help Me Choose" }[payload.selectedService] || payload.selectedService;
    document.getElementById("avr-confirm-items").textContent = String(payload.itemCount);
    document.getElementById("avr-confirm-email").textContent = payload.contactEmail;
    document.getElementById("avr-confirm-window").textContent = payload.expectedResponseWindow;
    confirmationEl.hidden = false;
    confirmationEl.setAttribute("tabindex", "-1");
    confirmationEl.focus();
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (isSubmitting || Date.now() - lastSubmissionAt < 8000) {
      return;
    }

    var validationMessages = validateForm();
    if (validationMessages.length > 0) {
      showErrorSummary(validationMessages);
      setStatus("Please fix the highlighted fields and try again.", "error");
      return;
    }

    showErrorSummary([]);

    if (!turnstileReady || typeof window.turnstile === "undefined") {
      setStatus("Spam protection is still loading. Please wait a moment and try again.", "error");
      return;
    }

    var turnstileToken = window.turnstile.getResponse(turnstileWidgetId);
    if (!turnstileToken) {
      setStatus("Please complete the spam protection check before submitting.", "error");
      return;
    }

    var formData = new FormData(form);
    formData.set("turnstileToken", turnstileToken);
    formData.set("authorization_ack", form.querySelector("#avr-authorization-ack").checked ? "on" : "");
    formData.set("limitations_ack", form.querySelector("#avr-limitations-ack").checked ? "on" : "");

    Array.from(itemsList.querySelectorAll(".avr-item-card")).forEach((card) => {
      var noSerialCheckbox = card.querySelector(".avr-no-serial-checkbox");
      var name = noSerialCheckbox.getAttribute("name");
      formData.set(name, noSerialCheckbox.checked ? "on" : "");
    });

    setSubmittingState(true);
    setStatus("Sending your request...", "pending");

    try {
      var response = await fetch("/api/age-verification-request", {
        method: "POST",
        headers: { Accept: "application/json" },
        body: formData
      });

      var payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Your request could not be sent. Please try again.");
      }

      lastSubmissionAt = Date.now();
      track("professional_request_submitted", {
        source: referral.source || "direct",
        result_status: referral.resultStatus || "",
        selected_service: payload.selectedService,
        item_count: payload.itemCount,
        customer_type: customerTypeSelect.value
      });

      showConfirmation(payload);
    } catch (error) {
      setStatus(error.message || "We couldn't send your request. Please try again.", "error");
      track("professional_request_submission_error", { selected_service: requestedServiceSelect.value });
      if (typeof window.turnstile !== "undefined" && turnstileWidgetId !== null) {
        window.turnstile.reset(turnstileWidgetId);
      }
    } finally {
      setSubmittingState(false);
    }
  }

  /* ==========================================================================
   * Event wiring
   * ========================================================================== */

  serviceCards.forEach((card) => {
    card.addEventListener("click", () => {
      setSelectedService(card.getAttribute("data-service-option"));
    });
  });

  requestedServiceSelect.addEventListener("change", () => {
    setSelectedService(requestedServiceSelect.value);
  });

  document.getElementById("avr-upsell-submit-cta").addEventListener("click", () => {
    setSelectedService("full_valuation");
  });

  customerTypeSelect.addEventListener("change", syncCompanyRequirement);

  addItemButton.addEventListener("click", () => {
    addItem();
  });

  form.addEventListener("input", () => {
    if (!hasTrackedFormStart) {
      hasTrackedFormStart = true;
      track("professional_request_form_started", { source: referral.source || "direct" });
    }
  });

  document.querySelectorAll('[data-analytics="full_valuation_upsell_clicked"]').forEach((el) => {
    el.addEventListener("click", () => {
      track("full_valuation_upsell_clicked", { source: referral.source || "direct" });
    });
  });

  form.addEventListener("submit", handleSubmit);

  /* ==========================================================================
   * Initialization (runs after every function/variable above is ready)
   * ========================================================================== */

  if (isReferral) {
    var introCopy = AVShared.getReferralIntroCopy(referral.resultStatus) || "Submit the item for human review, supporting-source research, and a professionally documented conclusion.";
    referralCopyEl.textContent = introCopy;
    referralBanner.hidden = false;
  }

  addHiddenField("source", referral.source);
  addHiddenField("result_id", referral.resultId);
  addHiddenField("result_status", referral.resultStatus);

  syncCompanyRequirement();

  var firstItemBlock = addItem();

  if (isReferral) {
    var categorySelect = firstItemBlock.querySelector('select[name$="_category"]');
    var brandInput = firstItemBlock.querySelector('input[name$="_brand"]');
    var modelInput = firstItemBlock.querySelector('input[name$="_model"]');

    // DecodeMyItem sends its own internal category keys (electronics,
    // appliances, hvac, waterHeaters), not this form's option values —
    // mapDecodeMyItemCategory() translates between them. Unknown/unmapped
    // keys resolve to "", which correctly leaves the field unselected
    // instead of forcing an incorrect value. The select stays fully
    // user-editable either way.
    var mappedCategory = AVShared.mapDecodeMyItemCategory(referral.category);
    if (mappedCategory) {
      categorySelect.value = mappedCategory;
    }
    if (referral.brand) {
      brandInput.value = referral.brand;
    }
    if (referral.model) {
      modelInput.value = referral.model;
    }

    setSelectedService("age_verification", { silent: true });
  }

  updateEstimate();

  waitForTurnstile()
    .then(renderTurnstile)
    .catch(() => {
      setStatus("Spam protection could not load. Refresh the page and try again.", "error");
    });

  track("professional_request_page_viewed", {
    source: referral.source || "direct",
    result_status: referral.resultStatus || "",
    category: referral.category || ""
  });
})();
