/* Page-scoped logic for /request-age-verification. Not part of the shared
 * global script.js — this workflow only exists on this page. */
(function () {
  "use strict";

  var AVShared = window.AVShared;
  var AVFileRules = window.AVFileRules;

  var SERVICE_LABELS = {
    age_verification: "Age Verification",
    item_pricing_valuation: "Item Pricing / Valuation",
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

  var emailInput = document.getElementById("avr-email");
  var phoneInput = document.getElementById("avr-phone");

  var methodRadios = Array.from(document.querySelectorAll('input[name="information_method"]'));
  var pathFieldsets = {
    enter_items_now: document.getElementById("avr-path-enter-items"),
    upload_or_paste_list: document.getElementById("avr-path-upload-paste"),
    list_needs_collection: document.getElementById("avr-path-collection")
  };
  var filesFieldset = document.getElementById("avr-path-files");

  var itemsList = document.getElementById("avr-items-list");
  var addItemButton = document.getElementById("avr-add-item");
  var itemCounter = 0;
  var itemCount = 0;

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

  /* ---------- Requested-services multi-select (checkbox-card group) ---------- */
  function syncServiceUi() {
    serviceCheckboxes.forEach((checkbox) => {
      var isChecked = selectedServices.indexOf(checkbox.value) !== -1;
      checkbox.checked = isChecked;
      var card = checkbox.closest("[data-service-card]");
      if (card) {
        card.classList.toggle("is-selected", isChecked);
      }
    });

    var allSelected = AVShared.isAllOfTheAboveSelected(selectedServices);
    serviceAllShortcut.checked = allSelected;
    var allCard = serviceAllShortcut.closest("[data-service-card]");
    if (allCard) {
      allCard.classList.toggle("is-selected", allSelected);
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

  /* ---------- Information-method progressive disclosure ---------- */
  function currentInformationMethod() {
    var checked = methodRadios.find((radio) => radio.checked);
    return checked ? checked.value : "";
  }

  function setInformationMethod(method) {
    Object.keys(pathFieldsets).forEach((key) => {
      pathFieldsets[key].hidden = key !== method;
    });

    filesFieldset.hidden = method !== "enter_items_now" && method !== "upload_or_paste_list";

    // Switching paths must never leave stale validation errors from the
    // previously-active path on screen.
    showErrorSummary([]);

    track("information_method_selected", { source: referral.source || "direct", method: method });
  }

  methodRadios.forEach((radio) => {
    radio.addEventListener("change", () => {
      setInformationMethod(radio.value);
    });
  });

  /* ---------- Dynamic item blocks ---------- */
  function buildCategoryOptionsHtml() {
    return (
      '<option value="">Select a category (optional)</option>' +
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
      <div class="form-group">
        <label for="avr-item-${index}-description">Item description</label>
        <input type="text" id="avr-item-${index}-description" name="item_${index}_description" placeholder="e.g. Living room television">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label for="avr-item-${index}-category">Category <span class="form-opt">(optional)</span></label>
          <select id="avr-item-${index}-category" name="item_${index}_category">${buildCategoryOptionsHtml()}</select>
        </div>
        <div class="form-group">
          <label for="avr-item-${index}-brand">Brand <span class="form-opt">(optional)</span></label>
          <input type="text" id="avr-item-${index}-brand" name="item_${index}_brand">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label for="avr-item-${index}-model">Model <span class="form-opt">(optional)</span></label>
          <input type="text" id="avr-item-${index}-model" name="item_${index}_model">
        </div>
        <div class="form-group">
          <label for="avr-item-${index}-serial">Serial number <span class="form-opt">(optional)</span></label>
          <input type="text" id="avr-item-${index}-serial" name="item_${index}_serial" placeholder="If known">
        </div>
      </div>
      <label class="avr-checkbox-row avr-no-serial-row">
        <input type="checkbox" name="item_${index}_no_serial" class="avr-no-serial-checkbox">
        <span>I do not have a readable serial number.</span>
      </label>
      <div class="form-row">
        <div class="form-group">
          <label for="avr-item-${index}-approx-age">Approximate age <span class="form-opt">(optional)</span></label>
          <input type="text" id="avr-item-${index}-approx-age" name="item_${index}_approximate_age" placeholder="e.g. About 5 years">
        </div>
        <div class="form-group">
          <label for="avr-item-${index}-research">Requested research <span class="form-opt">(optional)</span></label>
          <input type="text" id="avr-item-${index}-research" name="item_${index}_requested_research">
        </div>
      </div>
      <div class="form-group">
        <label for="avr-item-${index}-notes">Item-specific notes <span class="form-opt">(optional)</span></label>
        <textarea id="avr-item-${index}-notes" name="item_${index}_notes"></textarea>
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

    track("work_order_item_added", { item_count: itemCount });

    return block;
  }

  function removeItem(wrapper, index) {
    if (itemsList.querySelectorAll(".avr-item-card").length <= 1) {
      return;
    }

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
    var reason = form.querySelector("#avr-reason");

    if (!fullName.value.trim()) messages.push("Contact name is required.");

    var hasEmail = Boolean(email.value.trim());
    var hasPhone = Boolean(phone.value.trim());
    if (!hasEmail && !hasPhone) {
      messages.push("Please provide an email address or a phone number.");
    } else if (hasEmail && !email.checkValidity()) {
      messages.push("Please enter a valid email address.");
    }

    if (companyInput.required && !companyInput.value.trim()) messages.push("Company or organization is required for this customer type.");

    if (selectedServices.length === 0) messages.push("Please select at least one requested service.");
    if (!reason.value.trim()) messages.push("Please briefly describe the work order.");

    var informationMethod = currentInformationMethod();
    if (!informationMethod) {
      messages.push("Please select how you will provide the item information.");
    }

    if (!universalAck.checked) messages.push("Please confirm the authorization statement.");
    if (avLimitationsAck.required && !avLimitationsAck.checked) messages.push("Please confirm the service-limitations statement.");

    if (informationMethod === "enter_items_now") {
      var itemCards = Array.from(itemsList.querySelectorAll(".avr-item-card"));
      if (itemCards.length === 0) {
        messages.push("At least one item is required.");
      }
      itemCards.forEach((card, position) => {
        var descriptionEl = card.querySelector('input[name$="_description"]');
        if (!descriptionEl.value.trim()) {
          messages.push(`Item ${position + 1}: please provide a brief description.`);
        }
      });
    }

    if (informationMethod === "upload_or_paste_list") {
      var hasPastedText = Boolean(pastedListInput.value.trim());
      var hasUploadedFile = Array.from(form.querySelectorAll('input[type="file"]')).some((input) => (input.files || []).length > 0);
      var willProvideLater = willProvideLaterCheckbox.checked;
      if (!hasPastedText && !hasUploadedFile && !willProvideLater) {
        messages.push("Please upload a file, paste your item list, or confirm you will provide it after Item Assist contacts you.");
      }
    }

    if (informationMethod === "list_needs_collection") {
      if (!tpNameInput.value.trim()) {
        messages.push("Please provide the contact person or organization for item list collection.");
      }
      var tpHasPhone = Boolean(tpPhoneInput.value.trim());
      var tpHasEmail = Boolean(tpEmailInput.value.trim());
      if (!tpHasPhone && !tpHasEmail) {
        messages.push("Please provide an email address or a phone number for the item list collection contact.");
      }
      if (!tpAuthorizationAck.checked) {
        messages.push("Please confirm you are authorized to provide this contact and request contact on the assignment.");
      }
    }

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
    formData.set("information_method", currentInformationMethod());
    formData.set("universal_ack", universalAck.checked ? "on" : "");
    formData.set("limitations_ack", avLimitationsAck.required && avLimitationsAck.checked ? "on" : "");
    formData.set("will_provide_list_later", willProvideLaterCheckbox.checked ? "on" : "");
    formData.set("third_party_authorization_ack", tpAuthorizationAck.checked ? "on" : "");

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
      track("work_order_submitted", {
        source: referral.source || "direct",
        result_status: referral.resultStatus || "",
        requested_services: selectedServices.join(","),
        information_method: currentInformationMethod(),
        item_count: payload.itemCount
      });

      showConfirmation(payload);
    } catch (error) {
      setStatus(error.message || "We couldn't send your request. Please try again.", "error");
      track("work_order_submission_error", { information_method: currentInformationMethod() });
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

    var referralMethodRadio = document.getElementById("avr-method-enter_items_now");
    referralMethodRadio.checked = true;
    setInformationMethod("enter_items_now");
  }

  var firstItemBlock = addItem();

  if (isReferral) {
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
