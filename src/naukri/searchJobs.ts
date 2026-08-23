import type { Locator, Page } from "playwright";

export type Job = {
  title: string;
  company: string;
  location: string;
  experience?: string;
  jobUrl: string;
};

/** One search-result card. Each card also carries a data-job-id. */
const JOB_CARD = "div.srp-jobtuple-wrapper";

/** Naukri shows 20 results per page; Phase 1 reads page 1 only. */
const RESULTS_PER_PAGE = 20;

/**
 * Reads the trimmed text of a locator, or undefined when the element is absent.
 * Cards legitimately omit fields (e.g. undisclosed experience), so a missing
 * element is normal, not an error.
 */
async function optionalText(locator: Locator): Promise<string | undefined> {
  if ((await locator.count()) === 0) return undefined;
  const raw = await locator.first().textContent();
  const text = raw?.trim();
  return text ? text : undefined;
}

/**
 * True when Naukri is showing a CAPTCHA / OTP / bot check. We never try to
 * solve or bypass these - we hand the browser back to the human.
 */
async function needsHumanVerification(page: Page): Promise<boolean> {
  const signals = page.getByText(
    /captcha|verify (that )?you|unusual activity|are you a human|robot|enter otp|verification code/i
  );
  return (await signals.count()) > 0;
}

/** True when Naukri explicitly reports zero matches for the query. */
async function reportsNoJobs(page: Page): Promise<boolean> {
  const signals = page.getByText(
    /no jobs found|couldn't find any|could not find any|did not match|no results found/i
  );
  return (await signals.count()) > 0;
}

/**
 * Waits for job cards to render. Returns false when Naukri reports zero
 * matches. If a human verification step appears, pauses so it can be
 * completed manually in the visible browser window.
 */
async function waitForResults(page: Page): Promise<boolean> {
  const firstCard = page.locator(JOB_CARD).first();

  try {
    await firstCard.waitFor({ state: "visible", timeout: 45_000 });
    return true;
  } catch {
    // Cards did not appear. Work out why before failing.
  }

  if (await reportsNoJobs(page)) return false;

  if (await needsHumanVerification(page)) {
    console.log(
      "\n*** Naukri is asking for human verification (CAPTCHA / OTP / bot check).\n" +
        "*** Please complete it manually in the open browser window.\n" +
        "*** Waiting up to 5 minutes, then continuing automatically...\n"
    );
    await firstCard.waitFor({ state: "visible", timeout: 300_000 });
    return true;
  }

  throw new Error(
    `Search results never rendered. Current URL: ${page.url()}\n` +
      "Naukri may have changed its markup, or the page failed to load."
  );
}

/** Extracts one card. Returns null if the card is malformed or unusable. */
async function extractJob(card: Locator): Promise<Job | null> {
  const titleLink = card.locator("a.title").first();

  const title = await optionalText(titleLink);
  const company = await optionalText(card.locator("a.comp-name"));
  const rawJobUrl = (await titleLink.getAttribute("href"))?.trim();

  // Required Phase 1 fields: malformed cards are skipped by the caller.
  if (!title || !company || !rawJobUrl) return null;

  const jobUrl = new URL(rawJobUrl, "https://www.naukri.com").toString();

  return {
    title,
    company,
    location: (await optionalText(card.locator("span.locWdth"))) ?? "Not specified",
    experience: await optionalText(card.locator("span.expwdth")),
    jobUrl,
  };
}

/**
 * Searches Naukri from an already-authenticated page and returns up to
 * `maxJobs` results from the first page.
 *
 * Search and extract only - this never clicks Apply or modifies the account.
 *
 */
export async function searchJobs(
  page: Page,
  keyword: string,
  location: string,
  maxJobs: number
): Promise<Job[]> {
  console.log("Searching:");
  console.log(`Keyword: ${keyword}`);
  console.log(`Location: ${location}`);
  console.log();

  // The logged-in homepage initially renders the search inputs hidden behind
  // this accessible expand button.
  const keywordInput = page.locator(
    'input[aria-label="Enter keyword, designation, or companies"]:visible'
  );
  if ((await keywordInput.count()) === 0) {
    await page.getByRole("button", { name: "Search jobs here" }).click();
  }
  await keywordInput.waitFor({ state: "visible", timeout: 30_000 });

  await keywordInput.fill(keyword);
  await page
    .locator('input[aria-label="Enter location"]:visible')
    .fill(location);

  await page.getByRole("button", { name: "Search", exact: true }).click();

  let hasResults = await waitForResults(page);
  if (!hasResults) {
    console.log(`No jobs found for "${keyword}" in "${location}".`);
    return [];
  }

  if (maxJobs > RESULTS_PER_PAGE) {
    console.log(
      `Note: reading page 1 only, so at most ${RESULTS_PER_PAGE} jobs (you asked for ${maxJobs}).`
    );
  }

  const cards = await page.locator(JOB_CARD).all();
  const jobs: Job[] = [];

  for (const card of cards.slice(0, maxJobs)) {
    try {
      const job = await extractJob(card);
      if (job) jobs.push(job);
      else console.warn("Skipped a card with no title or URL.");
    } catch (error) {
      // One broken card must not abort the whole extraction.
      console.warn(
        "Skipped a malformed job card:",
        error instanceof Error ? error.message : error
      );
    }
  }

  return jobs;
}
