import type { Page } from "playwright";
import { openNaukri } from "./browser.js";

/** Header elements that only exist once a user is signed in. */
const LOGGED_IN_SIGNALS = [
  'a[href*="mnjuser/profile"]',
  'a[href*="mnjuser/homepage"]',
  'a[href*="mnjuser/recommendedjobs"]',
  ".nI-gNb-drawer__bars",
  "img.nI-gNb-usr__img",
].join(", ");

/** Naukri's header login button. Present only when signed out. */
const LOGIN_BUTTON = "#login_Layer";

/** How long to wait for a manual login before giving up. */
const LOGIN_TIMEOUT_MS =
  Number(process.env.LOGIN_TIMEOUT_MINUTES || 10) * 60_000;

/**
 * Reads the current auth state from the header. Returns null when neither
 * signal has rendered yet, so callers can tell "unknown" from "signed out".
 */
async function readAuthState(page: Page): Promise<boolean | null> {
  if ((await page.locator(LOGGED_IN_SIGNALS).count()) > 0) return true;
  if ((await page.locator(LOGIN_BUTTON).count()) > 0) return false;
  return null;
}

/** Checks the rendered header without navigating or exposing session data. */
export async function isNaukriAuthenticated(
  page: Page,
  timeout = 0
): Promise<boolean> {
  if ((await readAuthState(page)) === true) return true;

  if (timeout > 0) {
    try {
      await page
        .locator(LOGGED_IN_SIGNALS)
        .first()
        .waitFor({ state: "attached", timeout });
    } catch {
      return false;
    }
  }

  return (await readAuthState(page)) === true;
}

/**
 * Opens Naukri and guarantees an authenticated session before returning.
 * If signed out, prints instructions and waits for the login to be completed
 * by hand in the visible browser window. CAPTCHA / OTP are never automated.
 *
 * @throws if authentication cannot be confirmed within the timeout.
 */
export async function ensureNaukriAuthenticated(page: Page): Promise<void> {
  await openNaukri(page);

  // Naukri renders client-side. Wait for whichever header state appears first
  // rather than sleeping for a fixed duration.
  try {
    await page
      .locator(`${LOGGED_IN_SIGNALS}, ${LOGIN_BUTTON}`)
      .first()
      .waitFor({ state: "attached", timeout: 45_000 });
  } catch {
    throw new Error(
      "Could not determine authentication state - Naukri's header never " +
        `rendered. Current URL: ${page.url()}`
    );
  }

  if ((await readAuthState(page)) === true) {
    console.log("Authentication status: Logged in\n");
    return;
  }

  console.log("Authentication status: Not logged in\n");
  console.log("=".repeat(60));
  console.log("  ACTION NEEDED: please log in manually in the browser window.");
  console.log("  Complete any OTP / CAPTCHA / verification yourself.");
  console.log(`  Waiting up to ${LOGIN_TIMEOUT_MS / 60_000} minutes...`);
  console.log("=".repeat(60) + "\n");

  try {
    await page
      .locator(LOGGED_IN_SIGNALS)
      .first()
      .waitFor({ state: "attached", timeout: LOGIN_TIMEOUT_MS });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/closed/i.test(message)) {
      throw new Error("Browser was closed before login completed.");
    }
    throw new Error(
      "Login was not completed in time. Run the app again and finish logging in."
    );
  }

  console.log("Authentication status: Logged in\n");
}
