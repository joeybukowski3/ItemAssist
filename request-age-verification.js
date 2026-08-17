/* Page-scoped logic for /request-age-verification. Not part of the shared
 * global script.js — this workflow only exists on this page. */
(function () {
  "use strict";

  var AVShared = window.AVShared;
  var AVFileRules = window.AVFileRules;

  var SERVICE_LABELS = {
    age_verification: "Age Verification",
    item_pricing_valuation: "Item Consultation",
    item_list_collection: "Item List Collection",
    unsure: "Unsure — Help Me Determine the Scope"
  };

  /* ---------- Element lookups + state (must all be assigned before any
   * function below is invoked — several handlers read these eagerly). ---------- */
  var form = document.getElementById("avr-intake-form");
  var referralBanner = document.getElementById("avr-referral-banner");
  var referralCopyEl = document.getElementById("avr-referral-copy");

  var serviceCheckboxes = Array.from(document.querySelectorAll("[data-service-checkbox]"));
  var serviceAllShortcut = document.getElementById("avr-service-all");
  var selectedServices = [];

  var customerTypeSelect = document.getElementById("avr-customer-type");
  var companyInput = document.getElementById("avr-company");
  var companyOptionalLabel = document.getElementById("avr-company-optional");

  var itemsList = document.getElementById("avr-items-list");
  var addItemButton = document.getElementById("avr-add-item");
  var itemCounter = 0;
  var itemCount = 0;

  var methodRadios = Array.from(document.querySelectorAll('input[name="information_method"]'));
  var methodContentBlocks = {
    upload_or_paste_list: document.getElementById("avr-method-content-upload_or_paste_list"),
    enter_items_now: document.getElementById("avr-method-content-enter_items_now"),
    list_needs_collection: document.getElementById("avr-method-content-list_needs_collection")
  };

  var pastedListInput = document.getElementById("avr-pasted-list");
  var willProvideLaterCheckbox = document.getElementById("avr-will-provide-later");

  var tpNameInput = document.getElementById("avr-tp-name");
  var tpPhoneInput = document.getElementById("avr-tp-phone");
  var tpEmailInput = document.getElementById("avr-tp-email");
  var tpAuthorizationAck = document.getElementById("avr-tp-authorization-ack");

  var universalAck = document.getElementById("avr-universal-ack");
  var avLimitationsAckRow = document.getElementById("avr-av-limitations-row");
  var avLimitationsAck = document.getElementById("avr-limitations-ack");

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

  if (pastedListInput) {
    pastedListInput.setAttribute("maxlength", String(AVShared.MAX_PASTED_LIST_LENGTH));
  }

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

  /* ---------- Requested-services multi-select (checkbox rows) ---------- */
  function syncServiceUi() {
    serviceCheckboxes.forEach((checkbox) => {
      var isChecked = selectedServices.indexOf(checkbox.value) !== -1;
      checkbox.checked = isChecked;
      var row = checkbox.closest("[data-service-card]");
      if (row) {
        row.classList.toggle("is-selected", isChecked);
      }
    });

    var allSelected = AVShared.isAllOfTheAboveSelected(selectedServices);
    serviceAllShortcut.checked = allSelected;
    var allRow = serviceAllShortcut.closest("[data-service-card]");
    if (allRow) {
      allRow.classList.toggle("is-selected", allSelected);
    }

    syncAgeVerificationLimitationsAck();
  }

  function setSelectedServices(next, options) {
    selectedServices = next;
    syncServiceUi();

    if (!(options && options.silent)) {
      track("requested_services_changed", { source: referral.source || "direct", services: selectedServices.join(",") });
    }
  }

  function addServiceIfAbsent(value) {
    if (selectedServices.indexOf(value) === -1) {
      setSelectedServices(AVShared.toggleRequestedService(selectedServices, value));
    }
  }

  serviceCheckboxes.forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      setSelectedServices(AVShared.toggleRequestedService(selectedServices, checkbox.value));
    });
  });

  serviceAllShortcut.addEventListener("change", () => {
    setSelectedServices(AVShared.toggleRequestedService(selectedServices, "all"));
  });

  /* ---------- Age-Verification-specific limitations acknowledgement gating ---------- */
  function syncAgeVerificationLimitationsAck() {
    var required = AVShared.requiresAgeVerificationLimitationsAck(selectedServices);
    avLimitationsAckRow.hidden = !required;
    avLimitationsAck.required = required;
    if (!required) {
      avLimitationsAck.checked = false;
    }
  }

  /* ---------- Customer type / company requirement ---------- */
  function syncCompanyRequirement() {
    var isProfessional = AVShared.isProfessionalCustomerType(customerTypeSelect.value);
    companyInput.required = isProfessional;
    companyOptionalLabel.style.display = isProfessional ? "none" : "";
  }

  /* ---------- Explicit information-method selection ----------
   * informationMethod is set directly by the radio the user picks -- never
   * inferred from which content happens to be filled in. The three values
   * (upload_or_paste_list / enter_items_now / list_needs_collection) are
   * exactly the backend enum/schema/validation has always used; only the
   * client-side control changed. */
  function currentInformationMethod() {
    var checked = methodRadios.find((radio) => radio.checked);
    return checked ? checked.value : "";
  }

  function selectInformationMethod(method, options) {
    methodRadios.forEach((radio) => {
      var isChecked = radio.value === method;
      radio.checked = isChecked;
      var row = radio.closest("[data-method-row]");
      if (row) {
        row.classList.toggle("is-selected", isChecked);
      }
    });

    Object.keys(methodContentBlocks).forEach((key) => {
      methodContentBlocks[key].hidden = key !== method;
    });

    var seededItemBlock = null;
    if (method === "enter_items_now" && itemsList.children.length === 0) {
      seededItemBlock = addItem();
    }

    // Switching methods must never leave stale validation errors (summary,
    // field highlighting, or section highlighting) from the previously-
    // active method on screen.
    clearAllFieldInvalidState();
    showErrorSummary([]);

    if (!(options && options.silent)) {
      track("information_method_selected", { source: referral.source || "direct", method: method });
    }

    return seededItemBlock;
  }

  methodRadios.forEach((radio) => {
    radio.addEventListener("change", () => {
      selectInformationMethod(radio.value);
    });
  });

  /* ---------- Dense-grid item rows ---------- */
  function buildCategoryOptionsHtml() {
    return (
      '<option value="">Category (optional)</option>' +
      CATEGORY_OPTIONS.map((label) => `<option value="${label}">${label}</option>`).join("")
    );
  }

  function createItemBlock(index) {
    var wrapper = document.createElement("div");
    wrapper.className = "avr-item-row";
    wrapper.setAttribute("data-item-index", String(index));
    wrapper.innerHTML = `
      <div class="avr-item-row-main">
        <span class="avr-item-number-badge"></span>
        <input type="text" class="avr-item-description" id="avr-item-${index}-description" name="item_${index}_description" placeholder="Item description">
        <select class="avr-item-category" id="avr-item-${index}-category" name="item_${index}_category">${buildCategoryOptionsHtml()}</select>
        <button type="button" class="avr-remove-item" aria-label="Remove this item">&times;</button>
      </div>
      <p class="avr-field-error-msg" id="avr-item-${index}-description-error" hidden></p>
      <div class="avr-item-row-details">
        <input type="text" name="item_${index}_brand" placeholder="Brand (optional)">
        <input type="text" name="item_${index}_model" placeholder="Model (optional)">
        <input type="text" id="avr-item-${index}-serial" name="item_${index}_serial" placeholder="Serial (optional)">
        <label class="avr-item-no-serial">
          <input type="checkbox" name="item_${index}_no_serial" class="avr-no-serial-checkbox">
          <span>No serial</span>
        </label>
        <input type="text" name="item_${index}_approximate_age" placeholder="Approx. age (optional)">
        <input type="text" name="item_${index}_requested_research" placeholder="Requested research (optional)">
      </div>
      <textarea name="item_${index}_notes" class="avr-item-notes" placeholder="Notes (optional)" rows="1"></textarea>
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

    return wrapper;
  }

  function renumberItems() {
    // Removing every row is valid here (unlike the old always-at-least-
    // one-item design): informationMethod is set explicitly by the radio
    // selection, not derived from item count, so zero items under "Manually
    // enter item details" just means collectValidationIssues() reports
    // missing descriptions -- the remove button is never hidden.
    var rows = Array.from(itemsList.querySelectorAll(".avr-item-row"));
    rows.forEach((row, position) => {
      row.querySelector(".avr-item-number-badge").textContent = String(position + 1);
    });
  }

  function addItem() {
    var index = itemCounter;
    itemCounter += 1;
    itemCount += 1;

    var block = createItemBlock(index);
    itemsList.appendChild(block);
    renumberItems();

    track("work_order_item_added", { item_count: itemCount });

    return block;
  }

  function removeItem(wrapper, index) {
    wrapper.remove();
    itemCount -= 1;
    renumberItems();

    track("work_order_item_removed", { item_count: itemCount });
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
  }

  /**
   * Applies the soft "invalid" treatment to one or more fields: tinted
   * border/background, aria-invalid, the enclosing .avr-section-card (if
   * any) gets a matching soft highlight, and if the field lives inside a
   * collapsed <details> (e.g. company inside "Optional work-order
   * details"), that disclosure is opened so the highlighted field is
   * actually visible rather than hidden.
   *
   * @param {Array<HTMLElement|null|undefined>} elements
   * @param {string} message
   * @param {HTMLElement|null} errorEl dedicated inline message element
   */
  function setFieldInvalid(elements, message, errorEl) {
    (elements || []).forEach((el) => {
      if (!el) {
        return;
      }
      el.classList.add("avr-field-invalid");
      el.setAttribute("aria-invalid", "true");

      var detailsAncestor = el.closest("details");
      if (detailsAncestor && !detailsAncestor.open) {
        detailsAncestor.open = true;
      }

      var sectionCard = el.closest(".avr-section-card");
      if (sectionCard) {
        sectionCard.classList.add("avr-section-invalid");
      }
    });

    if (errorEl) {
      errorEl.textContent = message;
      errorEl.hidden = false;
    }
  }

  function clearAllFieldInvalidState() {
    Array.from(form.querySelectorAll(".avr-field-invalid")).forEach((el) => {
      el.classList.remove("avr-field-invalid");
      el.removeAttribute("aria-invalid");
    });
    Array.from(form.querySelectorAll(".avr-section-invalid")).forEach((el) => {
      el.classList.remove("avr-section-invalid");
    });
    Array.from(form.querySelectorAll(".avr-field-error-msg")).forEach((el) => {
      el.hidden = true;
      el.textContent = "";
    });
  }

  /** Renders both the flat #avr-error-summary list and the per-field/
   * per-section soft highlighting from the same structured issue list, so
   * the two views can never drift out of sync with each other. */
  function renderValidationIssues(issues) {
    clearAllFieldInvalidState();
    issues.forEach((issue) => setFieldInvalid(issue.elements, issue.message, issue.errorEl));
    showErrorSummary(issues.map((issue) => issue.message));
  }

  function focusFirstInvalidField(issues) {
    var firstWithElement = issues.find((issue) => issue.elements && issue.elements[0]);
    if (!firstWithElement) {
      errorSummary.focus();
      return;
    }
    var target = firstWithElement.elements[0];
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    if (typeof target.focus === "function") {
      target.focus({ preventScroll: true });
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

  /**
   * Returns structured validation issues -- each with the field(s) to
   * soft-highlight, the message shown both in the error summary and inline
   * under the field/section, and (optionally) the dedicated inline error
   * element to populate.
   *
   * @returns {Array<{elements: HTMLElement[], message: string, errorEl: HTMLElement|null}>}
   */
  function collectValidationIssues() {
    var issues = [];

    var fullName = form.querySelector("#avr-full-name");
    var email = form.querySelector("#avr-email");
    var phone = form.querySelector("#avr-phone");
    var reason = form.querySelector("#avr-reason");

    if (!fullName.value.trim()) {
      issues.push({ elements: [fullName], message: "Contact name is required.", errorEl: document.getElementById("avr-full-name-error") });
    }

    var hasEmail = Boolean(email.value.trim());
    var hasPhone = Boolean(phone.value.trim());
    if (!hasEmail && !hasPhone) {
      issues.push({
        elements: [email, phone],
        message: "Please provide an email address or a phone number.",
        errorEl: document.getElementById("avr-contact-method-error")
      });
    } else if (hasEmail && !email.checkValidity()) {
      issues.push({ elements: [email], message: "Please enter a valid email address.", errorEl: document.getElementById("avr-contact-method-error") });
    }

    if (companyInput.required && !companyInput.value.trim()) {
      issues.push({
        elements: [companyInput],
        message: "Company or organization is required for this customer type.",
        errorEl: document.getElementById("avr-company-error")
      });
    }

    if (selectedServices.length === 0) {
      issues.push({
        elements: [serviceCheckboxes[0]],
        message: "Please select at least one requested service.",
        errorEl: document.getElementById("avr-services-error")
      });
    }

    if (!reason.value.trim()) {
      issues.push({ elements: [reason], message: "Please briefly describe the work order.", errorEl: document.getElementById("avr-reason-error") });
    }

    if (!universalAck.checked) {
      issues.push({
        elements: [document.getElementById("avr-universal-ack-row") || universalAck],
        message: "Please confirm the authorization statement.",
        errorEl: document.getElementById("avr-universal-ack-error")
      });
    }
    if (avLimitationsAck.required && !avLimitationsAck.checked) {
      issues.push({
        elements: [avLimitationsAckRow],
        message: "Please confirm the service-limitations statement.",
        errorEl: document.getElementById("avr-limitations-ack-error")
      });
    }

    var informationMethod = currentInformationMethod();
    if (!informationMethod) {
      issues.push({
        elements: methodRadios,
        message: "Please select how you are providing the item information.",
        errorEl: document.getElementById("avr-method-error")
      });
    }

    if (informationMethod === "enter_items_now") {
      var itemRows = Array.from(itemsList.querySelectorAll(".avr-item-row"));
      itemRows.forEach((row, position) => {
        var descriptionEl = row.querySelector('input[name$="_description"]');
        if (!descriptionEl.value.trim()) {
          issues.push({
            elements: [descriptionEl],
            message: `Item ${position + 1}: please provide a brief description.`,
            errorEl: row.querySelector(".avr-field-error-msg")
          });
        }
      });
    }

    if (informationMethod === "upload_or_paste_list") {
      var hasPastedText = Boolean(pastedListInput.value.trim());
      var hasUploadedFile = Array.from(form.querySelectorAll('input[type="file"]')).some((input) => (input.files || []).length > 0);
      var willProvideLater = willProvideLaterCheckbox.checked;
      if (!hasPastedText && !hasUploadedFile && !willProvideLater) {
        issues.push({
          elements: [pastedListInput],
          message: "Please upload a file, paste your item list, or confirm you will provide it after Item Assist contacts you.",
          errorEl: document.getElementById("avr-upload-paste-error")
        });
      }
    }

    if (informationMethod === "list_needs_collection") {
      if (!tpNameInput.value.trim()) {
        issues.push({
          elements: [tpNameInput],
          message: "Please provide the contact person or organization for item list collection.",
          errorEl: document.getElementById("avr-tp-name-error")
        });
      }
      var tpHasPhone = Boolean(tpPhoneInput.value.trim());
      var tpHasEmail = Boolean(tpEmailInput.value.trim());
      if (!tpHasPhone && !tpHasEmail) {
        issues.push({
          elements: [tpPhoneInput, tpEmailInput],
          message: "Please provide an email address or a phone number for the item list collection contact.",
          errorEl: document.getElementById("avr-tp-contact-method-error")
        });
      }
      if (!tpAuthorizationAck.checked) {
        issues.push({
          elements: [document.getElementById("avr-tp-authorization-row") || tpAuthorizationAck],
          message: "Please confirm you are authorized to provide this contact and request contact on the assignment.",
          errorEl: document.getElementById("avr-tp-authorization-error")
        });
      }
    }

    var fileError = collectFileErrors();
    if (fileError) {
      issues.push({ elements: [], message: fileError, errorEl: null });
    }

    return issues;
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
    var services = Array.isArray(payload.requestedServices) ? payload.requestedServices : [];
    document.getElementById("avr-confirm-service").textContent = services.map((value) => SERVICE_LABELS[value] || value).join(", ") || "Not specified";
    document.getElementById("avr-confirm-items").textContent = String(payload.itemCount);
    document.getElementById("avr-confirm-email").textContent = payload.contactEmail || "See phone contact";
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

    var validationIssues = collectValidationIssues();
    if (validationIssues.length > 0) {
      renderValidationIssues(validationIssues);
      setStatus("Please fix the highlighted fields and try again.", "error");
      focusFirstInvalidField(validationIssues);
      return;
    }

    renderValidationIssues([]);

    if (!turnstileReady || typeof window.turnstile === "undefined") {
      setStatus("Spam protection is still loading. Please wait a moment and try again.", "error");
      return;
    }

    var turnstileToken = window.turnstile.getResponse(turnstileWidgetId);
    if (!turnstileToken) {
      setStatus("Please complete the spam protection check before submitting.", "error");
      return;
    }

    var informationMethod = currentInformationMethod();

    var formData = new FormData(form);
    formData.set("turnstileToken", turnstileToken);
    formData.set("information_method", informationMethod);
    formData.set("universal_ack", universalAck.checked ? "on" : "");
    formData.set("limitations_ack", avLimitationsAck.required && avLimitationsAck.checked ? "on" : "");
    formData.set("will_provide_list_later", willProvideLaterCheckbox.checked ? "on" : "");
    formData.set("third_party_authorization_ack", tpAuthorizationAck.checked ? "on" : "");

    Array.from(itemsList.querySelectorAll(".avr-item-row")).forEach((row) => {
      var noSerialCheckbox = row.querySelector(".avr-no-serial-checkbox");
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
      track("work_order_submitted", {
        source: referral.source || "direct",
        result_status: referral.resultStatus || "",
        requested_services: selectedServices.join(","),
        information_method: informationMethod,
        item_count: payload.itemCount
      });

      showConfirmation(payload);
    } catch (error) {
      setStatus(error.message || "We couldn't send your request. Please try again.", "error");
      track("work_order_submission_error", { information_method: informationMethod });
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

  document.getElementById("avr-upsell-submit-cta").addEventListener("click", () => {
    addServiceIfAbsent("item_pricing_valuation");
  });

  customerTypeSelect.addEventListener("change", syncCompanyRequirement);

  addItemButton.addEventListener("click", () => {
    addItem();
  });

  form.addEventListener("input", () => {
    if (!hasTrackedFormStart) {
      hasTrackedFormStart = true;
      track("work_order_form_started", { source: referral.source || "direct" });
    }
  });

  // Live-clear soft validation highlighting as the user fixes fields --
  // only once an error summary is actually showing (i.e. after a failed
  // submit attempt), so nothing is highlighted pre-emptively before the
  // user has ever tried to submit.
  function liveClearValidationHighlighting() {
    if (errorSummary.hidden) {
      return;
    }
    renderValidationIssues(collectValidationIssues());
  }
  form.addEventListener("input", liveClearValidationHighlighting);
  form.addEventListener("change", liveClearValidationHighlighting);

  document.querySelectorAll('[data-analytics="item_pricing_valuation_upsell_clicked"]').forEach((el) => {
    el.addEventListener("click", () => {
      track("item_pricing_valuation_upsell_clicked", { source: referral.source || "direct" });
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
  syncServiceUi();

  if (isReferral) {
    setSelectedServices(AVShared.toggleRequestedService(selectedServices, "age_verification"), { silent: true });

    // DecodeMyItem always implies exactly one known item, so "Manually enter
    // item details" is selected automatically -- still fully changeable by
    // the user either way. selectInformationMethod() seeds the first empty
    // item row itself; reuse it rather than adding a second one.
    var firstItemBlock = selectInformationMethod("enter_items_now", { silent: true });
    var categorySelect = firstItemBlock.querySelector('select[name$="_category"]');
    var brandInput = firstItemBlock.querySelector('input[name$="_brand"]');
    var modelInput = firstItemBlock.querySelector('input[name$="_model"]');
    var descriptionInput = firstItemBlock.querySelector('input[name$="_description"]');

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
    if (referral.brand || referral.model) {
      descriptionInput.value = [referral.brand, referral.model].filter(Boolean).join(" ");
    }
  } else {
    // Direct visitors default to the lowest-friction method -- still a
    // real, changeable selection, not an implicit fallback.
    selectInformationMethod("upload_or_paste_list", { silent: true });
  }

  waitForTurnstile()
    .then(renderTurnstile)
    .catch(() => {
      setStatus("Spam protection could not load. Refresh the page and try again.", "error");
    });

  track("work_order_page_viewed", {
    source: referral.source || "direct",
    result_status: referral.resultStatus || "",
    category: referral.category || ""
  });
})();
