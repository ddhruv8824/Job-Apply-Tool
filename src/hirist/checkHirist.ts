import { buildSearchUrl, createHiristClient, extractHiristJobId, isHiristUrl, type HiristJobDetailRaw, type HiristTransport } from "./api.js";
import { classifyHiristJob } from "./applicationType.js";
import { htmlToText, mapJobDetail } from "./getJobDetails.js";
import { resolveLocationIds } from "./locations.js";
import { mapSearchJob, searchJobsPage } from "./searchJobs.js";

function expect(condition: boolean, message: string): void { if (!condition) throw new Error(message); }

// Shapes copied from live gladiator.hirist.tech responses (trimmed).
const searchRow = {
  id: 1671060, title: "Happiest Minds Technologies - Senior Frontend Developer - React.js Frameworks", min: 6, max: 10,
  jobdesignation: "Senior Frontend Developer",
  jobDetailUrl: "https://www.hirist.tech/j/happiest-minds-technologies-senior-frontend-developer-react-js-frameworks-1671060?ref=x",
  tags: [{ id: 2043, name: "React.js", isMandatory: true }, { id: 26, name: "Javascript", isMandatory: true }, { id: 2510, name: "TypeScript", isMandatory: false }],
  locations: [{ id: 3, name: "Bangalore" }, { id: 7, name: "Pune" }], createdTimeMs: 1789199169760,
  companyData: { companyName: "Happiest Minds Technologies" },
};
const detail: HiristJobDetailRaw = {
  ...searchRow, applyUrl: "", hasExpired: false, active: 1, permanentlyRemoved: false, assessmentFlags: 0, mediaResume: 0,
  introText: "<p><b>Job Summary :</b><br/><br/>We are looking for an experienced Frontend React JS Developer &amp; mentor.<br/><br/>- Build reusable components.<br/>- Integrate REST APIs.<br/></p><ul><li>6 - 10 years of experience in frontend development.</li></ul>",
};

// URL and identity helpers.
expect(extractHiristJobId("https://www.hirist.tech/j/acme-frontend-developer-1671060") === "1671060", "Job id extraction failed");
expect(extractHiristJobId("https://www.hirist.tech/j/acme-frontend-developer-1671060?ref=hpjob") === "1671060", "Job id with query failed");
expect(extractHiristJobId("https://example.com/j/acme-123456") === undefined, "Non-Hirist URL produced an id");
expect(isHiristUrl("https://gladiator.hirist.tech/job") && !isHiristUrl("https://evilhirist.tech/") && !isHiristUrl("not a url"), "Hirist host check failed");
const url = new URL(buildSearchUrl({ keyword: "Frontend Developer", locationIds: [7, 3], minExperience: 1, maxExperience: 3 }, 2));
expect(url.searchParams.get("query") === "Frontend Developer" && url.searchParams.get("loc") === "7,3" && url.searchParams.get("page") === "2"
  && url.searchParams.get("minexp") === "1" && url.searchParams.get("maxexp") === "3", "Search URL parameters failed");
expect(!new URL(buildSearchUrl({ keyword: "React", locationIds: [] }, 0)).searchParams.has("loc"), "Empty location should not filter");

// Locations.
expect(resolveLocationIds("Pune").join() === "7", "Pune lookup failed");
expect(resolveLocationIds(" pune , Bengaluru, Gurugram ").join() === "7,3,37", "Multi-location/alias lookup failed");
expect(resolveLocationIds("").length === 0, "Empty location should resolve to no filter");
let unknownRejected = false;
try { resolveLocationIds("Atlantis"); } catch { unknownRejected = true; }
expect(unknownRejected, "Unknown location was not rejected");

// Search row mapping.
const job = mapSearchJob(searchRow);
expect(job?.jobId === "1671060" && job.company === "Happiest Minds Technologies" && job.location === "Bangalore/Pune" && job.experience === "6 - 10 yrs", "Search mapping failed");
expect(job?.jobUrl === "https://www.hirist.tech/j/happiest-minds-technologies-senior-frontend-developer-react-js-frameworks-1671060", "Tracking query was not stripped from job URL");
expect(mapSearchJob({ id: 5, title: "Senior Dev & Lead", confidential: 1 })?.jobUrl === "https://www.hirist.tech/j/senior-dev-and-lead-5", "Fallback slug URL failed");
expect(mapSearchJob({ id: 0, title: "" }) === null, "Malformed row was not rejected");

// Description and detail mapping.
const text = htmlToText(detail.introText!);
expect(text.startsWith("Job Summary :\n\nWe are looking") && text.includes("Developer & mentor.") && text.includes("- 6 - 10 years") && !/[<>]/.test(text), "HTML to text failed");
const detailed = mapJobDetail(job!, detail);
expect(detailed.applicationType === "HIRIST_DIRECT" && !detailed.screeningRequired, "Direct classification failed");
expect(detailed.mandatorySkills?.join() === "React.js,Javascript" && detailed.skills?.length === 3, "Mandatory skill mapping failed");
expect(detailed.postedDate === "2026-09-12" && detailed.role === "Senior Frontend Developer", "Detail metadata mapping failed");
let shortRejected = false;
try { mapJobDetail(job!, { ...detail, introText: "<p>Too short</p>" }); } catch { shortRejected = true; }
expect(shortRejected, "Short description was not rejected");

// Application type classification.
expect(classifyHiristJob(null).applicationType === "UNKNOWN", "Missing job classification failed");
expect(classifyHiristJob({ ...detail, hasExpired: true }).applicationType === "UNKNOWN", "Expired job classified as direct");
expect(classifyHiristJob({ ...detail, active: 0 }).applicationType === "UNKNOWN", "Inactive job classified as direct");
const external = classifyHiristJob({ ...detail, applyUrl: "https://careers.example.com/apply/1" });
expect(external.applicationType === "EXTERNAL_COMPANY" && external.externalApplicationUrl === "https://careers.example.com/apply/1", "External apply URL classification failed");
expect(classifyHiristJob({ ...detail, applyUrl: "https://www.hirist.tech/apply/1" }).applicationType === "HIRIST_DIRECT", "On-platform apply URL misclassified");
expect(classifyHiristJob({ ...detail, title: "Walk-in Drive - React Developer" }).applicationType === "WALK_IN", "Walk-in classification failed");
expect(classifyHiristJob({ ...detail, assessmentFlags: 1 }).screeningRequired === true, "Assessment job was not flagged for screening");
expect(classifyHiristJob({ ...detail, assessmentFlags: 1, assessmentCompleted: true }).screeningRequired === false, "Completed assessment still flagged");
expect(classifyHiristJob({ ...detail, mediaResume: 1 }).screeningRequired === true, "Video-resume job was not flagged for screening");

// Client: pagination, detail caching, fresh reads, and auth refresh.
const requests: string[] = [];
let loggedIn = false;
const fake: HiristTransport = async (target) => {
  requests.push(target);
  const path = new URL(target).pathname;
  if (path === "/job/search") return { status: 200, body: { data: [searchRow], hasMore: new URL(target).searchParams.get("page") === "0" } };
  if (path === "/job/detail") return { status: 200, body: { data: detail } };
  if (path === "/auth/validate") return { status: loggedIn ? 200 : 401, body: null };
  if (path === "/auth/refresh") { loggedIn = true; return { status: 200, body: null }; }
  return { status: 404, body: null };
};
const client = createHiristClient(fake, { minIntervalMs: 0 });
const first = await searchJobsPage(client, { keyword: "React", locationIds: [7] }, 0);
const last = await searchJobsPage(client, { keyword: "React", locationIds: [7] }, 1);
expect(first.nextPageToken === "1" && last.nextPageToken === null && first.jobs.length === 1, "Pagination tokens failed");
await client.jobDetail("1671060"); await client.jobDetail("1671060");
expect(requests.filter((item) => item.includes("/job/detail")).length === 1, "Detail cache failed");
await client.jobDetail("1671060", { fresh: true });
expect(requests.filter((item) => item.includes("/job/detail")).length === 2, "Fresh detail read used the cache");
expect(await client.isAuthenticated() && requests.some((item) => item.endsWith("/auth/refresh")), "Expired session was not refreshed");
const rejected = createHiristClient(async () => ({ status: 401, body: null }), { minIntervalMs: 0 });
expect(!(await rejected.isAuthenticated()), "Logged-out session reported as authenticated");

console.log("Hirist URL/id helpers: PASSED");
console.log("Location resolution: PASSED");
console.log("Search/detail mapping and HTML cleanup: PASSED");
console.log("Direct/external/expired/walk-in/screening classification: PASSED");
console.log("Client pagination, detail cache, auth refresh: PASSED");
