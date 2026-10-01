import type { Page } from "playwright";
import { createHiristClient, isHiristUrl, pageTransport } from "./api.js";
import { openHirist } from "./browser.js";

/** How long to wait for a manual login before giving up. */
const LOGIN_TIMEOUT_MS =
  Number(process.env.LOGIN_TIMEOUT_MINUTES || 10) * 60_000;
const LOGIN_POLL_MS = 5_000;

/**
 * Asks Hirist's own /auth/validate endpoint from inside the tab, so the
 * user's session cookies decide the answer. Never navigates or reads cookies.
 */
export async function isHiristAuthenticated(page: Page): Promise<boolean> {
  if (!isHiristUrl(page.url())) return false;
  try {
    return await createHiristClient(pageTransport(page), { minIntervalMs: 0 }).isAuthenticated();
  } catch {
    return false;
  }
}

/** Non-interactive scheduled preflight. It never waits for credentials, OTP, or CAPTCHA input. */
export async function preflightHiristAuthentication(page: Page): Promise<boolean> {
  await openHirist(page);
  return isHiristAuthenticated(page);
}

/**
 * Opens Hirist and guarantees an authenticated session before returning.
 * If signed out, prints instructions and waits for the login to be completed
 * by hand in the visible browser window. OTP / CAPTCHA are never automated.
 *
 * @throws if authentication cannot be confirmed within the timeout.
 */
export async function ensureHiristAuthenticated(page: Page): Promise<void> {
  await openHirist(page);

  if (await isHiristAuthenticated(page)) {
    console.log("Authentication status: Logged in\n");
    return;
  }

  console.log("Authentication status: Not logged in\n");
  console.log("=".repeat(60));
  console.log("  ACTION NEEDED: please log in to hirist.tech manually in the browser window.");
  console.log("  Complete any OTP / CAPTCHA / verification yourself.");
  console.log(`  Waiting up to ${LOGIN_TIMEOUT_MS / 60_000} minutes...`);
  console.log("=".repeat(60) + "\n");

  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (page.isClosed()) throw new Error("Browser was closed before login completed.");
    await new Promise<void>((resolve) => setTimeout(resolve, LOGIN_POLL_MS));
    if (await isHiristAuthenticated(page)) {
      console.log("Authentication status: Logged in\n");
      return;
    }
  }
  throw new Error("Login was not completed in time. Run the app again and finish logging in.");
}
