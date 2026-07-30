const AVShared = require("../../../assets/js/av-shared.js");

const CUSTOMER_TYPES = AVShared.CUSTOMER_TYPES;
const PROFESSIONAL_CUSTOMER_TYPES = AVShared.PROFESSIONAL_CUSTOMER_TYPES;
const CONCRETE_SERVICES = AVShared.CONCRETE_SERVICES;
const REQUESTED_SERVICE_VALUES = AVShared.REQUESTED_SERVICE_VALUES;
const INFORMATION_METHODS = AVShared.INFORMATION_METHODS;
const RESULT_STATUSES = AVShared.RESULT_STATUSES;

const PREFERRED_CONTACT_METHODS = ["email", "phone", "either"];

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidEmail(value) {
  return isNonEmptyString(value) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function isProfessionalCustomerType(customerType) {
  return PROFESSIONAL_CUSTOMER_TYPES.indexOf(customerType) !== -1;
}

function requiresAgeVerificationLimitationsAck(requestedServices) {
  return AVShared.requiresAgeVerificationLimitationsAck(requestedServices);
}

/**
 * Universal fields required on every work order, regardless of information
 * method: contact name, at least one of email/phone, at least one requested
 * service, an information method, and a brief description. Everything else
 * (customer type, company, preferred contact method) is optional.
 *
 * @param {object} fields
 * @returns {string[]} field-level validation errors, empty when valid
 */
function validateContactFields(fields) {
  const errors = [];
  const data = fields || {};

  if (!isNonEmptyString(data.fullName)) {
    errors.push("Contact name is required.");
  }

  const hasEmail = isNonEmptyString(data.email);
  const hasPhone = isNonEmptyString(data.phone);

  if (!hasEmail && !hasPhone) {
    errors.push("Please provide an email address or a phone number.");
  } else if (hasEmail && !isValidEmail(data.email)) {
    errors.push("Please enter a valid email address.");
  }

  if (data.customerType && CUSTOMER_TYPES.indexOf(data.customerType) === -1) {
    errors.push("Please select a valid customer type.");
  }

  if (data.preferredContactMethod && PREFERRED_CONTACT_METHODS.indexOf(data.preferredContactMethod) === -1) {
    errors.push("Please select a valid preferred contact method.");
  }

  if (isProfessionalCustomerType(data.customerType) && !isNonEmptyString(data.company)) {
    errors.push("Company or organization is required for this customer type.");
  }

  const requestedServices = Array.isArray(data.requestedServices) ? data.requestedServices : [];
  if (requestedServices.length === 0) {
    errors.push("Please select at least one requested service.");
  } else if (requestedServices.some((value) => REQUESTED_SERVICE_VALUES.indexOf(value) === -1)) {
    errors.push("One or more requested services are not valid.");
  }

  if (INFORMATION_METHODS.indexOf(data.informationMethod) === -1) {
    errors.push("Please select how you will provide the item information.");
  }

  if (!isNonEmptyString(data.workOrderDescription)) {
    errors.push("Please briefly describe the work order.");
  }

  if (!data.universalAck) {
    errors.push("Please confirm the authorization statement before submitting.");
  }

  if (requiresAgeVerificationLimitationsAck(requestedServices) && !data.ageVerificationLimitationsAck) {
    errors.push("Please confirm the service-limitations statement before submitting.");
  }

  return errors;
}

/**
 * Enter Items Now: only a non-empty description is required per item.
 *
 * @param {object} item
 * @returns {string[]}
 */
function validateItem(item) {
  const errors = [];
  const data = item || {};

  if (!isNonEmptyString(data.description)) {
    errors.push("Please provide a brief item description.");
  }

  return errors;
}

/**
 * @param {Array<object>} items
 * @returns {string[]}
 */
function validateItems(items) {
  const list = Array.isArray(items) ? items : [];

  if (list.length === 0) {
    return ["At least one item is required."];
  }

  const errors = [];
  list.forEach((item, index) => {
    validateItem(item).forEach((message) => {
      errors.push(`Item ${index + 1}: ${message}`);
    });
  });

  return errors;
}

/**
 * Upload or Paste an Item List: valid when any one of a file, pasted text,
 * or "will provide later" is present. None is individually required.
 *
 * @param {{hasUploadedFile:boolean, pastedText:string, willProvideLater:boolean}} data
 * @returns {string[]}
 */
function validateItemList(data) {
  const value = data || {};
  const hasFile = Boolean(value.hasUploadedFile);
  const hasPastedText = isNonEmptyString(value.pastedText);
  const willProvideLater = Boolean(value.willProvideLater);

  if (!hasFile && !hasPastedText && !willProvideLater) {
    return ["Please upload a file, paste your item list, or confirm you will provide it after Item Assist contacts you."];
  }

  return [];
}

/**
 * Item List Still Needs to Be Collected: requires a contact name/org, at
 * least one of email/phone for that third party, and the contact
 * authorization acknowledgement.
 *
 * @param {object} data
 * @returns {string[]}
 */
function validateThirdPartyCollection(data) {
  const errors = [];
  const value = data || {};

  if (!isNonEmptyString(value.contactNameOrOrg)) {
    errors.push("Please provide the contact person or organization for item list collection.");
  }

  const hasEmail = isNonEmptyString(value.email);
  const hasPhone = isNonEmptyString(value.phone);
  if (!hasEmail && !hasPhone) {
    errors.push("Please provide an email address or a phone number for the item list collection contact.");
  }

  if (!value.authorizationAck) {
    errors.push("Please confirm you are authorized to provide this contact and request contact on the assignment.");
  }

  return errors;
}

/**
 * Dispatches to the correct conditional validator for the selected
 * information method.
 *
 * @param {string} informationMethod
 * @param {object} pathData
 * @returns {string[]}
 */
function validateInformationMethodPath(informationMethod, pathData) {
  if (informationMethod === "enter_items_now") {
    return validateItems((pathData && pathData.items) || []);
  }
  if (informationMethod === "upload_or_paste_list") {
    return validateItemList((pathData && pathData.itemList) || {});
  }
  if (informationMethod === "list_needs_collection") {
    return validateThirdPartyCollection((pathData && pathData.thirdPartyCollection) || {});
  }
  return [];
}

function isValidResultStatus(value) {
  return value === "" || RESULT_STATUSES.indexOf(value) !== -1;
}

module.exports = {
  CUSTOMER_TYPES,
  PROFESSIONAL_CUSTOMER_TYPES,
  CONCRETE_SERVICES,
  REQUESTED_SERVICE_VALUES,
  INFORMATION_METHODS,
  PREFERRED_CONTACT_METHODS,
  isNonEmptyString,
  isValidEmail,
  isProfessionalCustomerType,
  requiresAgeVerificationLimitationsAck,
  validateContactFields,
  validateItem,
  validateItems,
  validateItemList,
  validateThirdPartyCollection,
  validateInformationMethodPath,
  isValidResultStatus
};
