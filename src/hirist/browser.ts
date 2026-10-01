import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import { HIRIST_ORIGIN, isHiristUrl } from "./api.js";

const CDP_ENDPOINT = "http://localhost:9222";
const CHROME_COMMAND =
  '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" ' +
  '--remote-debugging-port=9222 --user-data-dir="C:\\hirist-agent-profile"';

export type Session = {
  browser: Browser;
  context: BrowserContext;
  page: Page;
};

/**
 * Attaches to the dedicated Chrome instance started by the user. This never
 * launches a browser or accesses the user's normal Chrome profile.
 */
export async function connectToChrome(): Promise<Session> {
  let browser: Browser;

  try {
    browser = await chromium.connectOverCDP(CDP_ENDPOINT, { timeout: 10_000 });
  } catch {
    throw new Error(
      "Could not connect to Chrome on port 9222.\n\n" +
        "Start Chrome with remote debugging enabled:\n\n" +
        CHROME_COMMAND
    );
  }

  const contexts = browser.contexts();
  const context = contexts[0];
  if (!context) {
    throw new Error("No Chrome browser context found");
  }

  const pages = context.pages();
  const page =
    pages.find((candidate) => isHiristUrl(candidate.url())) ??
    (await context.newPage());

  return { browser, context, page };
}

/** Opens the Hirist home page, with a clearer error if the site is unreachable. */
export async function openHirist(page: Page): Promise<void> {
  try {
    await page.goto(`${HIRIST_ORIGIN}/`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
  } catch (error) {
    throw new Error(
      "Could not load hirist.tech - check your internet connection. " +
        `(${error instanceof Error ? error.message : error})`
    );
  }
}
