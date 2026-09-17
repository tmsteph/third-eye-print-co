import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { chromium } from "playwright";

const ROOT = path.resolve(process.cwd());
const PORT = 8787;
const HOST = "127.0.0.1";
const BASE = `http://${HOST}:${PORT}`;
const OUT = path.join(ROOT, "artifacts", "screenshots");
fs.mkdirSync(OUT, { recursive: true });

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitForServer() {
  for (let i = 0; i < 80; i += 1) {
    try { if ((await fetch(BASE)).ok) return; } catch {}
    await wait(200);
  }
  throw new Error("Local server did not start");
}

function browserExecutable() {
  for (const candidate of [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, "/usr/bin/google-chrome", "/usr/bin/chromium"]) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

async function mockConfig(page) {
  await page.route("**/config.js", async (route) => route.fulfill({
    status: 200,
    contentType: "application/javascript",
    body: `window.THIRD_EYE_CONFIG=${JSON.stringify({
      stripeEnabled: true,
      stripeCatalog: { businessCards: {
        key: "businessCards", label: "Business cards", currency: "usd", defaultOptionId: "cards-100", options: [
          {id:"cards-50",label:"50 cards",amountCents:2000},
          {id:"cards-100",label:"100 cards",amountCents:2900},
          {id:"cards-250",label:"250 cards",amountCents:3900},
          {id:"cards-500",label:"500 cards",amountCents:5900}
        ]
      }}
    })};`
  }));
}

async function checkLauncher(browser, width, height, name) {
  const page = await browser.newPage({ viewport: { width, height }, colorScheme: "dark" });
  await page.goto(BASE, { waitUntil: "networkidle" });
  const href = await page.locator('a[href="/business-cards/"]').first().getAttribute("href");
  if (href !== "/business-cards/") throw new Error("Homepage business-card CTA is not a separate page");
  if (await page.locator('a[href^="#quote"]').count()) throw new Error("Homepage still contains the old scrolling order CTA");
  const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  if (scrollHeight > height + 220) throw new Error(`Homepage is too tall for ${name}: ${scrollHeight}px`);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  await page.close();
}

async function checkCardCheckout(browser) {
  const page = await browser.newPage({ viewport: { width: 430, height: 900 }, colorScheme: "dark" });
  await mockConfig(page);
  let checkoutBody = null;
  await page.route("**/api/create-checkout-session", async (route) => {
    checkoutBody = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "cs_test", url: `${BASE}/business-cards/?payment=cancelled` }) });
  });
  await page.goto(`${BASE}/business-cards/`, { waitUntil: "networkidle" });
  if (await page.getByText("Call or text", { exact: false }).count()) throw new Error("Card checkout still contains call/text distractions");
  if ((await page.locator("#qty button").count()) !== 4) throw new Error("Expected four card quantities");
  if (!(await page.locator("#pay").isEnabled())) throw new Error("Payment should be available without artwork");
  if (await page.locator('input[type="file"]').count()) throw new Error("Unimplemented artwork upload must not be exposed");
  const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  if (scrollHeight > 980) throw new Error(`Business-card checkout is too tall: ${scrollHeight}px`);

  await page.locator("#qty button").filter({ hasText: "250" }).click();
  await page.screenshot({ path: path.join(OUT, "business-cards-mobile.png"), fullPage: true });
  await page.locator("#pay").click();
  await page.waitForURL("**/business-cards/?payment=cancelled");
  if (!checkoutBody || checkoutBody.lead.checkoutOptionId !== "cards-250") throw new Error("Selected quantity did not reach checkout");
  if (checkoutBody.lead.artStatus !== "Send artwork later") throw new Error("Checkout must preserve the post-payment artwork handoff");
  await page.close();
}

const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", HOST], { cwd: ROOT, stdio: "ignore" });
try {
  await waitForServer();
  const browser = await chromium.launch({ executablePath: browserExecutable(), args: ["--no-sandbox", "--disable-setuid-sandbox"], headless: true });
  try {
    await checkLauncher(browser, 1440, 900, "launcher-desktop");
    await checkLauncher(browser, 430, 900, "launcher-mobile");
    await checkCardCheckout(browser);
    console.log("App-style visual smoke check passed.");
  } finally { await browser.close(); }
} finally { server.kill("SIGTERM"); }
