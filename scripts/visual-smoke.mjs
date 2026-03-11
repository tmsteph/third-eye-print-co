import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { chromium } from "playwright";

const ROOT = path.resolve(process.cwd());
const PORT = 8787;
const HOST = "127.0.0.1";
const BASE_URL = `http://${HOST}:${PORT}`;
const SCREENSHOT_DIR = path.join(ROOT, "artifacts", "screenshots");

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFileSize(filePath) {
  return fs.statSync(filePath).size;
}

function resolveChromeExecutable() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium"
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch (_error) {
      // Ignore missing browser candidates and keep looking.
    }
  }

  return null;
}

function countTracks(values, tolerance = 8) {
  const tracks = [];

  for (const value of [...values].sort((left, right) => left - right)) {
    const lastTrack = tracks[tracks.length - 1];
    if (lastTrack === undefined || Math.abs(value - lastTrack) > tolerance) {
      tracks.push(value);
    }
  }

  return tracks.length;
}

function roundMetric(metric) {
  return {
    label: metric.label,
    x: Math.round(metric.x),
    y: Math.round(metric.y),
    width: Math.round(metric.width),
    height: Math.round(metric.height)
  };
}

async function waitForServer(url, attempts = 100) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch (_error) {
      // Ignore boot races.
    }

    await wait(250);
  }

  throw new Error(`Server did not become ready at ${url}`);
}

async function assertHtmlContains(url, requiredFragments) {
  const response = await fetch(url);
  const html = await response.text();
  const missing = requiredFragments.filter((fragment) => !html.includes(fragment));

  if (missing.length) {
    throw new Error(`Missing expected content at ${url}: ${missing.join(", ")}`);
  }
}

async function captureHomepage(browser, scenario) {
  const page = await browser.newPage({
    colorScheme: "dark",
    viewport: {
      width: scenario.width,
      height: scenario.height
    }
  });

  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);

  const buttons = page.locator(".hero-actions > .btn, .hero-actions > .phone-action .btn");
  const buttonCount = await buttons.count();
  if (buttonCount !== 4) {
    throw new Error(`Expected 4 hero CTA buttons for ${scenario.name}, received ${buttonCount}`);
  }

  const metrics = await buttons.evaluateAll((elements) => {
    return elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        label: element.textContent.replace(/\s+/g, " ").trim(),
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height
      };
    });
  });

  const columnCount = countTracks(metrics.map((metric) => metric.x));
  const rowCount = countTracks(metrics.map((metric) => metric.y));
  const widthSpread = Math.max(...metrics.map((metric) => metric.width)) - Math.min(...metrics.map((metric) => metric.width));
  const heightSpread = Math.max(...metrics.map((metric) => metric.height)) - Math.min(...metrics.map((metric) => metric.height));

  if (columnCount !== scenario.expectedColumns) {
    throw new Error(`Expected ${scenario.expectedColumns} CTA columns for ${scenario.name}, received ${columnCount}`);
  }

  if (rowCount !== scenario.expectedRows) {
    throw new Error(`Expected ${scenario.expectedRows} CTA rows for ${scenario.name}, received ${rowCount}`);
  }

  if (widthSpread > 4) {
    throw new Error(`Hero CTA widths drifted by ${widthSpread.toFixed(2)}px for ${scenario.name}`);
  }

  if (heightSpread > 2) {
    throw new Error(`Hero CTA heights drifted by ${heightSpread.toFixed(2)}px for ${scenario.name}`);
  }

  const screenshotPath = path.join(SCREENSHOT_DIR, `${scenario.name}.png`);
  await page.screenshot({
    path: screenshotPath,
    fullPage: true
  });
  await page.close();

  return {
    name: scenario.name,
    file: screenshotPath,
    bytes: getFileSize(screenshotPath),
    viewport: {
      width: scenario.width,
      height: scenario.height
    },
    columns: columnCount,
    rows: rowCount,
    buttons: metrics.map(roundMetric)
  };
}

async function waitForStatusMessage(page, expectedMessage) {
  await page.waitForFunction((message) => {
    const node = document.getElementById("formMsg");
    return node && node.textContent === message;
  }, expectedMessage);
}

async function mockRuntimeConfig(page, config) {
  await page.route("**/config.js", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: `window.THIRD_EYE_CONFIG = ${JSON.stringify(config)};`
    });
  });
}

async function assertChoosePackageButtonNavigatesToShop(browser) {
  const page = await browser.newPage({
    colorScheme: "dark",
    viewport: {
      width: 1440,
      height: 900
    }
  });

  await mockRuntimeConfig(page, { stripeEnabled: true });
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.locator("#quoteForm").scrollIntoViewIfNeeded();
  const beforeScrollY = await page.evaluate(() => window.scrollY);
  const defaultCheckoutOptions = await page.locator("#checkoutOptionId option").evaluateAll((options) => {
    return options.map((option) => ({
      value: option.value,
      label: option.textContent.replace(/\s+/g, " ").trim()
    }));
  });

  const buttonState = await page.evaluate(() => {
    const button = document.getElementById("payDepositBtn");
    const depositNote = document.getElementById("depositNote");
    return {
      hidden: button ? button.hidden : null,
      disabled: button ? button.disabled : null,
      label: button ? button.textContent.trim() : "",
      depositNoteHidden: depositNote ? depositNote.hidden : null
    };
  });

  if (
    defaultCheckoutOptions.length !== 4
    || defaultCheckoutOptions[0].value !== ""
    || defaultCheckoutOptions[0].label !== "Choose a package..."
    || defaultCheckoutOptions[1].value !== "service:businessCards"
    || !defaultCheckoutOptions[1].label.startsWith("Business cards - from ")
    || defaultCheckoutOptions[2].value !== "service:eventTent"
    || !defaultCheckoutOptions[2].label.startsWith("Event tents - from ")
    || defaultCheckoutOptions[3].value !== "service:bundleDeal"
    || !defaultCheckoutOptions[3].label.startsWith("Tent and card bundles - from ")
  ) {
    throw new Error("Default checkout selector did not expose the three main product paths.");
  }

  if (
    buttonState.hidden !== false
    || buttonState.disabled !== false
    || buttonState.label !== "Choose a package"
    || buttonState.depositNoteHidden !== true
  ) {
    throw new Error("Default checkout state did not expose an active 'Choose a package' button.");
  }

  await page.locator("#payDepositBtn").click();
  await waitForStatusMessage(page, "Choose a package above to continue to checkout.");
  await page.waitForFunction((previousY) => window.scrollY < previousY - 150, beforeScrollY);

  await page.selectOption("#checkoutOptionId", "service:eventTent");
  const resolvedPathState = await page.evaluate(() => {
    const field = document.getElementById("checkoutOptionId");
    const serviceType = document.getElementById("serviceType");
    const fieldLabel = document.getElementById("checkoutOptionFieldLabel");
    const button = document.getElementById("payDepositBtn");

    return {
      currentValue: field ? field.value : "",
      optionValues: field ? Array.from(field.options).map((option) => option.value) : [],
      serviceType: serviceType ? serviceType.value : "",
      fieldLabel: fieldLabel ? fieldLabel.textContent.replace(/\s+/g, " ").trim() : "",
      buttonLabel: button ? button.textContent.replace(/\s+/g, " ").trim() : ""
    };
  });

  if (
    resolvedPathState.serviceType !== "Event tents"
    || resolvedPathState.fieldLabel !== "Event tents package"
    || !resolvedPathState.currentValue
    || resolvedPathState.currentValue.startsWith("service:")
    || !resolvedPathState.optionValues.includes("tent-1")
    || !resolvedPathState.buttonLabel.startsWith("Checkout ")
  ) {
    throw new Error("Selecting a default checkout path did not load package checkout state.");
  }

  await page.close();
}

async function assertQuoteValidationMessages(browser) {
  const page = await browser.newPage({
    colorScheme: "dark",
    viewport: {
      width: 1440,
      height: 2200
    }
  });

  await mockRuntimeConfig(page, { stripeEnabled: true });
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.locator("#quoteForm").scrollIntoViewIfNeeded();

  await page.locator("#sendQuoteBtn").click();
  await waitForStatusMessage(page, "Add an email address so we can send your quote.");

  const emailInvalid = await page.locator("#email").getAttribute("aria-invalid");
  if (emailInvalid !== "true") {
    throw new Error("Quote validation did not flag the email field when it was missing.");
  }

  await page.locator("#email").fill("buyer@example.com");
  await page.locator("#sendQuoteBtn").click();
  await waitForStatusMessage(page, "Add a phone number so we can follow up about your quote.");

  const phoneInvalid = await page.locator("#phone").getAttribute("aria-invalid");
  if (phoneInvalid !== "true") {
    throw new Error("Quote validation did not flag the phone field when it was missing.");
  }

  await page.locator("#phone").fill("+1 (619) 555-0100");
  await page.locator("#sendQuoteBtn").click();
  await waitForStatusMessage(page, "Add a few project details so we know what to quote.");

  const notesInvalid = await page.locator("#notes").getAttribute("aria-invalid");
  if (notesInvalid !== "true") {
    throw new Error("Quote validation did not flag the notes field when custom quote details were missing.");
  }

  await page.close();
}

async function assertCustomQuoteUi(browser) {
  const page = await browser.newPage({
    colorScheme: "dark",
    viewport: {
      width: 1440,
      height: 2200
    }
  });

  await mockRuntimeConfig(page, { stripeEnabled: true });
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.locator("#quoteForm").scrollIntoViewIfNeeded();
  await page.locator('[data-service-choice="Custom quote"]').click();

  const customQuoteState = await page.evaluate(() => {
    const checkoutSection = document.getElementById("checkoutOptionSection");
    const payButton = document.getElementById("payDepositBtn");
    const depositNote = document.getElementById("depositNote");
    const choiceNote = document.getElementById("serviceChoiceNote");

    return {
      checkoutSectionHidden: checkoutSection ? checkoutSection.hidden : null,
      payButtonHidden: payButton ? payButton.hidden : null,
      depositNoteHidden: depositNote ? depositNote.hidden : null,
      choiceNoteHidden: choiceNote ? choiceNote.hidden : null,
      choiceNoteText: choiceNote ? choiceNote.textContent.trim() : null,
      sendQuoteLabel: document.getElementById("sendQuoteBtn")?.textContent.trim() || ""
    };
  });

  if (customQuoteState.checkoutSectionHidden !== true) {
    throw new Error("Custom quote mode still shows the checkout package controls.");
  }

  if (customQuoteState.payButtonHidden !== true) {
    throw new Error("Custom quote mode still shows the checkout button.");
  }

  if (customQuoteState.depositNoteHidden !== true) {
    throw new Error("Custom quote mode still shows the deposit note.");
  }

  if (customQuoteState.choiceNoteHidden !== true || customQuoteState.choiceNoteText !== "") {
    throw new Error("Custom quote mode still shows helper copy that should be hidden.");
  }

  if (customQuoteState.sendQuoteLabel !== "Send custom quote request") {
    throw new Error("Custom quote mode did not keep the expected quote submit button label.");
  }

  await page.close();
}

async function assertCheckoutAllowsMissingIdentity(browser) {
  const page = await browser.newPage({
    colorScheme: "dark",
    viewport: {
      width: 1440,
      height: 2200
    }
  });
  let checkoutRequest = null;

  await mockRuntimeConfig(page, { stripeEnabled: true });
  await page.route("**/api/create-checkout-session", async (route) => {
    checkoutRequest = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "cs_test_stub",
        url: `${BASE_URL}/?checkout=stub`
      })
    });
  });

  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.locator("#quoteForm").scrollIntoViewIfNeeded();
  await page.locator('[data-service-choice="Business cards"]').click();
  await page.waitForFunction(() => {
    const field = document.getElementById("checkoutOptionId");
    return field && !field.disabled && Boolean(field.value);
  });
  await page.locator("#payDepositBtn").click();
  await page.waitForURL((url) => url.searchParams.get("checkout") === "stub");

  if (!checkoutRequest || !checkoutRequest.lead) {
    throw new Error("Checkout request was not captured during the Playwright smoke test.");
  }

  if (
    checkoutRequest.lead.name !== ""
    || checkoutRequest.lead.email !== ""
    || checkoutRequest.lead.phone !== ""
    || checkoutRequest.lead.contact !== ""
  ) {
    throw new Error("Checkout request unexpectedly required name, email, or phone before payment.");
  }

  await page.close();
}

const scenarios = [
  {
    name: "homepage-desktop-playwright",
    width: 1440,
    height: 2200,
    expectedColumns: 2,
    expectedRows: 2
  },
  {
    name: "homepage-tablet-playwright",
    width: 820,
    height: 2200,
    expectedColumns: 1,
    expectedRows: 4
  },
  {
    name: "homepage-mobile-playwright",
    width: 430,
    height: 2200,
    expectedColumns: 1,
    expectedRows: 4
  }
];

const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", HOST], {
  cwd: ROOT,
  env: { ...process.env },
  stdio: "inherit"
});

try {
  await waitForServer(BASE_URL);

  await assertHtmlContains(BASE_URL, [
    "Get cards and tents fast. Need custom specs? Get a quote.",
    "Choose your order path",
    "Request a quote"
  ]);
  await assertHtmlContains(`${BASE_URL}/auth/`, [
    "Portal sign in",
    "Open portal",
    "Create account"
  ]);
  await assertHtmlContains(`${BASE_URL}/portal/`, [
    "What this page is for",
    "What is coming next"
  ]);
  await assertHtmlContains(`${BASE_URL}/admin/`, [
    "Quotes and orders, in one place.",
    "Lead feed"
  ]);

  const browser = await chromium.launch({
    executablePath: resolveChromeExecutable() ?? undefined,
    headless: true
  });

  try {
    const report = [];

    for (const scenario of scenarios) {
      report.push(await captureHomepage(browser, scenario));
    }

    await assertChoosePackageButtonNavigatesToShop(browser);
    await assertCustomQuoteUi(browser);
    await assertQuoteValidationMessages(browser);
    await assertCheckoutAllowsMissingIdentity(browser);

    fs.writeFileSync(
      path.join(SCREENSHOT_DIR, "report.json"),
      JSON.stringify(report, null, 2)
    );

    console.log("Visual smoke check passed.");
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser.close();
  }
} finally {
  server.kill("SIGTERM");
}
