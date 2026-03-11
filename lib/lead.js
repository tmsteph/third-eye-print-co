const CLEAN_LIMITS = {
  name: 120,
  company: 120,
  email: 180,
  phone: 80,
  contact: 180,
  quoteId: 120,
  serviceType: 120,
  checkoutOptionId: 120,
  checkoutOptionLabel: 120,
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
  const email = cleanText(input.email, CLEAN_LIMITS.email);
  const phone = cleanText(input.phone, CLEAN_LIMITS.phone);
  const fallbackContact = cleanText(input.contact, CLEAN_LIMITS.contact);
  const contact = fallbackContact || cleanText([email, phone].filter(Boolean).join(" / "), CLEAN_LIMITS.contact);

  return {
    name: cleanText(input.name, CLEAN_LIMITS.name),
    company: cleanText(input.company, CLEAN_LIMITS.company),
    email,
    phone,
    contact,
    quoteId: cleanText(input.quoteId, CLEAN_LIMITS.quoteId),
    serviceType: cleanText(input.serviceType, CLEAN_LIMITS.serviceType),
    checkoutOptionId: cleanText(input.checkoutOptionId, CLEAN_LIMITS.checkoutOptionId),
    checkoutOptionLabel: cleanText(input.checkoutOptionLabel, CLEAN_LIMITS.checkoutOptionLabel),
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

module.exports = {
  CLEAN_LIMITS,
  cleanText,
  normalizeLead,
};
