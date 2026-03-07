const test = require("node:test");
const assert = require("node:assert/strict");

const {
  cleanText,
  minimalLeadValidation,
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
    contact: " jane@example.com ",
    serviceType: " Screen Print ",
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
    contact: "jane@example.com",
    serviceType: "Screen Print",
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

test("minimalLeadValidation requires name and contact", () => {
  assert.equal(minimalLeadValidation({ name: "Jane", contact: "jane@example.com" }), true);
  assert.equal(minimalLeadValidation({ name: "Jane", contact: "" }), false);
  assert.equal(minimalLeadValidation({ name: "", contact: "jane@example.com" }), false);
});
