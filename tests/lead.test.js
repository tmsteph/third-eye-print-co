const test = require("node:test");
const assert = require("node:assert/strict");

const {
  cleanText,
  normalizeLead,
} = require("../lib/lead");

test("cleanText trims, collapses whitespace, and truncates", () => {
  assert.equal(cleanText("  hello   world  ", 11), "hello world");
  assert.equal(cleanText("abcdef", 4), "abcd");
  assert.equal(cleanText(null, 10), "");
});

test("normalizeLead sanitizes all expected fields", () => {
  const lead = normalizeLead({
    name: "  Jane   Doe  ",
    company: "  Third Eye   ",
    email: " jane@example.com ",
    phone: " +1 (619) 555-1212 ",
    quoteId: " quote-123 ",
    serviceType: " Screen Print ",
    checkoutOptionId: " cards-100 ",
    checkoutOptionLabel: " 100 cards ",
    quantity: " 144 ",
    colors: " 4 ",
    garment: " Tee ",
    locations: " Front / Back ",
    artStatus: " Ready ",
    needBy: " April 10 ",
    budget: " $900 ",
    fulfillment: " Pickup ",
    notes: " Need this before launch week. ",
  });

  assert.deepEqual(lead, {
    name: "Jane Doe",
    company: "Third Eye",
    email: "jane@example.com",
    phone: "+1 (619) 555-1212",
    contact: "jane@example.com / +1 (619) 555-1212",
    quoteId: "quote-123",
    serviceType: "Screen Print",
    checkoutOptionId: "cards-100",
    checkoutOptionLabel: "100 cards",
    quantity: "144",
    colors: "4",
    garment: "Tee",
    locations: "Front / Back",
    artStatus: "Ready",
    needBy: "April 10",
    budget: "$900",
    fulfillment: "Pickup",
    notes: "Need this before launch week.",
  });
});
