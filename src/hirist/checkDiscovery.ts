import { discoverDirectJobsCore, type ApplicationInspection, type DiscoveryConfig, type DiscoveryPage } from "./discoverDirectJobs.js";
import type { Job } from "./searchJobs.js";

function expect(condition: boolean, message: string): void { if (!condition) throw new Error(message); }
function job(id: number): Job { return { title: `Job ${id}`, company: "Company", location: "Pune", jobUrl: `https://www.naukri.com/job-${id}` }; }
const base: DiscoveryConfig = { keyword: "Frontend Developer", location: "Pune", targetDirectJobs: 2, maxJobsToInspect: 20, maxPages: 5 };
function inspector(types: Record<number, ApplicationInspection["applicationType"]>, calls: number[]) {
  return async (value: Job): Promise<ApplicationInspection> => {
    const id = Number(value.jobUrl.match(/(\d+)$/)?.[1]); calls.push(id);
    return { job: value, applicationType: types[id] ?? "UNKNOWN" };
  };
}

const earlyCalls: number[] = [];
const early = await discoverDirectJobsCore(base, {
  loadFirstPage: async () => ({ jobs: [job(1), job(2), job(3), job(4), job(5)], nextPageToken: "p2" }),
  loadPage: async () => { throw new Error("Unnecessary page visited"); },
  inspect: inspector({ 1: "EXTERNAL_COMPANY", 2: "NAUKRI_DIRECT", 3: "EXTERNAL_COMPANY", 4: "NAUKRI_DIRECT" }, earlyCalls),
});
expect(early.inspectedJobs === 4 && early.directCount === 2 && earlyCalls.length === 4, "Early target stop failed");

const max = await discoverDirectJobsCore({ ...base, targetDirectJobs: 10, maxJobsToInspect: 5 }, {
  loadFirstPage: async () => ({ jobs: [1, 2, 3, 4, 5, 6].map(job), nextPageToken: "p2" }),
  loadPage: async () => { throw new Error("Max inspection pagination failed"); },
  inspect: inspector({}, []),
});
expect(max.inspectedJobs === 5 && max.directCount === 0, "Max inspection stop failed");

let pageTwoVisits = 0;
const pages: Record<string, DiscoveryPage> = {
  p2: { jobs: [job(2), job(3), job(4)], nextPageToken: null },
};
const paginatedCalls: number[] = [];
const paginated = await discoverDirectJobsCore(base, {
  loadFirstPage: async () => ({ jobs: [job(1), job(2)], nextPageToken: "p2" }),
  loadPage: async (token) => { pageTwoVisits += 1; return pages[token] ?? null; },
  inspect: inspector({ 3: "NAUKRI_DIRECT", 4: "NAUKRI_DIRECT" }, paginatedCalls),
});
expect(pageTwoVisits === 1 && paginated.pagesVisited === 2 && paginated.directCount === 2, "Pagination failed");
expect(paginatedCalls.filter((id) => id === 2).length === 1, "Deduplication failed");

let forbiddenPageVisit = false;
await discoverDirectJobsCore({ ...base, targetDirectJobs: 1 }, {
  loadFirstPage: async () => ({ jobs: [job(8)], nextPageToken: "p2" }),
  loadPage: async () => { forbiddenPageVisit = true; return null; },
  inspect: inspector({ 8: "NAUKRI_DIRECT" }, []),
});
expect(!forbiddenPageVisit, "Unnecessary pagination occurred");

console.log("Early-target stop: PASSED");
console.log("Maximum-inspection stop: PASSED");
console.log("Deduplication: PASSED");
console.log("Pagination: PASSED");
console.log("No-unnecessary-pagination: PASSED");
