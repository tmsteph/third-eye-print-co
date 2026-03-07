import fs from "fs";
import path from "path";
import { spawn } from "child_process";

const ROOT = path.resolve(process.cwd());
const PORT = 8787;
const HOST = "127.0.0.1";
const BASE_URL = `http://${HOST}:${PORT}`;
const SCREENSHOT_DIR = path.join(ROOT, "artifacts", "screenshots");

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "pipe" });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve(stderr.trim());
        return;
      }

      reject(new Error(`${command} exited with code ${code}\n${stderr}`));
    });
  });
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
    throw new Error(`Missing expected content: ${missing.join(", ")}`);
  }
}

async function captureChromium(name, width, height, extraArgs = []) {
  const output = path.join(SCREENSHOT_DIR, `${name}.png`);
  const args = [
    "--headless",
    "--disable-gpu",
    "--hide-scrollbars",
    `--window-size=${width},${height}`,
    `--screenshot=${output}`,
    ...extraArgs,
    BASE_URL
  ];

  await run("chromium-browser", args);
  return output;
}

async function captureFirefox(name, width, height) {
  const output = path.join(SCREENSHOT_DIR, `${name}.png`);
  const args = [
    "--headless",
    "--window-size",
    `${width},${height}`,
    "--screenshot",
    output,
    BASE_URL
  ];

  await run("firefox", args);
  return output;
}

function getFileSize(filePath) {
  return fs.statSync(filePath).size;
}

const server = spawn("vercel", ["dev", "--yes", "--listen", `${HOST}:${PORT}`], {
  cwd: ROOT,
  env: { ...process.env },
  stdio: "inherit"
});

try {
  await waitForServer(BASE_URL);

  await assertHtmlContains(BASE_URL, [
    "Core offerings",
    "Starter packages",
    "Request a quote"
  ]);
  await assertHtmlContains(`${BASE_URL}/auth/`, [
    "Admin sign in",
    "Open admin dashboard",
    "Create Gun identity"
  ]);
  await assertHtmlContains(`${BASE_URL}/admin/`, [
    "Reactive lead feed, no long-lived app server.",
    "Lead feed"
  ]);

  const outputs = [];
  outputs.push({
    name: "chromium-desktop",
    file: await captureChromium("chromium-desktop", 1440, 3200)
  });
  outputs.push({
    name: "firefox-desktop",
    file: await captureFirefox("firefox-desktop", 1440, 3200)
  });
  outputs.push({
    name: "chromium-mobile",
    file: await captureChromium("chromium-mobile", 430, 3200, [
      "--user-agent=Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/122.0.0.0 Mobile/15E148 Safari/604.1"
    ])
  });

  const report = outputs.map(({ name, file }) => ({
    name,
    file,
    bytes: getFileSize(file)
  }));

  fs.writeFileSync(
    path.join(SCREENSHOT_DIR, "report.json"),
    JSON.stringify(report, null, 2)
  );

  console.log("Visual smoke check passed.");
  console.log(JSON.stringify(report, null, 2));
} finally {
  server.kill("SIGTERM");
}
