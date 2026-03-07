const CLEAN_LIMITS = {
  name: 120,
  company: 120,
  contact: 180,
  serviceType: 120,
  quantity: 40,
  colors: 40,
  garment: 120,
  locations: 160,
  artStatus: 120,
  needBy: 80,
  budget: 80,
  fulfillment: 120,
  notes: 2000,
};

function cleanText(value, maxLength) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeLead(input = {}) {
  return {
    name: cleanText(input.name, CLEAN_LIMITS.name),
    company: cleanText(input.company, CLEAN_LIMITS.company),
    contact: cleanText(input.contact, CLEAN_LIMITS.contact),
    serviceType: cleanText(input.serviceType, CLEAN_LIMITS.serviceType),
    quantity: cleanText(input.quantity, CLEAN_LIMITS.quantity),
    colors: cleanText(input.colors, CLEAN_LIMITS.colors),
    garment: cleanText(input.garment, CLEAN_LIMITS.garment),
    locations: cleanText(input.locations, CLEAN_LIMITS.locations),
    artStatus: cleanText(input.artStatus, CLEAN_LIMITS.artStatus),
    needBy: cleanText(input.needBy, CLEAN_LIMITS.needBy),
    budget: cleanText(input.budget, CLEAN_LIMITS.budget),
    fulfillment: cleanText(input.fulfillment, CLEAN_LIMITS.fulfillment),
    notes: cleanText(input.notes, CLEAN_LIMITS.notes),
  };
}

function minimalLeadValidation(lead) {
  return Boolean(lead && lead.name) && Boolean(lead && lead.contact);
}

module.exports = {
  CLEAN_LIMITS,
  cleanText,
  minimalLeadValidation,
  normalizeLead,
};
