import type { Page } from "playwright";
import type { DetailedJob } from "./getJobDetails.js";

export type ApplicationType = "NAUKRI_DIRECT" | "EXTERNAL_COMPANY" | "WALK_IN" | "UNKNOWN";
export type ApplicationTypeDetection = {
  applicationType: ApplicationType;
  applicationLabel?: string;
  externalApplicationUrl?: string;
};

export function classifyApplicationSignals(signals: {
  walkInLabel?: string; externalLabel?: string; externalApplicationUrl?: string; directLabel?: string;
}): ApplicationTypeDetection {
  if (signals.walkInLabel) return { applicationType: "WALK_IN", applicationLabel: signals.walkInLabel };
  if (signals.externalLabel) return { applicationType: "EXTERNAL_COMPANY", applicationLabel: signals.externalLabel, externalApplicationUrl: signals.externalApplicationUrl };
  if (signals.directLabel) return { applicationType: "NAUKRI_DIRECT", applicationLabel: signals.directLabel };
  return { applicationType: "UNKNOWN" };
}

/** Read-only classification. It never clicks or navigates through an application control. */
export async function detectApplicationType(page: Page): Promise<ApplicationTypeDetection> {
  const heading = ((await page.locator("h1").first().textContent().catch(() => null)) ?? "").trim();
  const pageTitle = await page.title();
  if (/\bwalk[\s-]?in\b/i.test(`${heading} ${pageTitle}`)) {
    return classifyApplicationSignals({ walkInLabel: heading || "Walk-in" });
  }

  // Verified live DOM: external applications use this stable ID/class and label.
  const external = page.locator("button#company-site-button.company-site-button:visible").first();
  if ((await external.count()) > 0) {
    const applicationLabel = (await external.innerText()).trim();
    const rawUrl = (await external.getAttribute("href")) ?? (await external.getAttribute("data-url"));
    let externalApplicationUrl: string | undefined;
    if (rawUrl) {
      try {
        const candidate = new URL(rawUrl, page.url());
        if (!/(^|\.)naukri\.com$/i.test(candidate.hostname)) externalApplicationUrl = candidate.toString();
      } catch { /* Malformed DOM metadata is intentionally ignored. */ }
    }
    return classifyApplicationSignals({ externalLabel: applicationLabel, externalApplicationUrl });
  }

  // A direct classification requires an exact Apply control inside Naukri's
  // verified application-control container, with no external marker or URL.
  const container = page.locator('[class^="styles_jhc__apply-button-container"]:visible').first();
  if ((await container.count()) > 0) {
    const direct = container.getByRole("button", { name: /^apply(?: now)?$/i }).first();
    if ((await direct.count()) > 0) {
      const marker = `${await direct.getAttribute("id")} ${await direct.getAttribute("class")}`;
      const rawUrl = (await direct.getAttribute("href")) ?? (await direct.getAttribute("data-url"));
      if (!/company.?site|external/i.test(marker) && !rawUrl) {
        return classifyApplicationSignals({ directLabel: (await direct.innerText()).trim() });
      }
    }
  }
  return classifyApplicationSignals({});
}

export function partitionJobsByApplicationType(jobs: DetailedJob[]) {
  return {
    directJobs: jobs.filter((job) => job.applicationType === "NAUKRI_DIRECT"),
    externalJobs: jobs.filter((job) => job.applicationType === "EXTERNAL_COMPANY"),
    walkInJobs: jobs.filter((job) => job.applicationType === "WALK_IN"),
    unknownJobs: jobs.filter((job) => job.applicationType === "UNKNOWN"),
  };
}
