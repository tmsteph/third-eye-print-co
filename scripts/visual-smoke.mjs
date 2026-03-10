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
