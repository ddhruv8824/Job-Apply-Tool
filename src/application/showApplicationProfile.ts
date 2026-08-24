import { loadApplicationProfile } from "./loadApplicationProfile.js";

const value = (input: unknown): string => input === undefined ? "UNKNOWN" : String(input);
const profile = await loadApplicationProfile();
console.log("APPLICATION PROFILE\n");
console.log(`Current location: ${value(profile.currentLocation)}`);
console.log(`Preferred locations: ${profile.preferredLocations?.join(", ") ?? "UNKNOWN"}`);
console.log(`Notice period: ${profile.noticePeriodDays === undefined ? "UNKNOWN" : `${profile.noticePeriodDays} days`}`);
console.log(`Current CTC: ${value(profile.currentCtc)}`);
console.log(`Expected CTC: ${value(profile.expectedCtc)}`);
console.log(`Willing to relocate: ${value(profile.willingToRelocate)}`);
console.log(`Currently employed: ${value(profile.currentlyEmployed)}`);
console.log(`Work authorization: ${value(profile.workAuthorization)}`);
console.log(`Joining availability: ${value(profile.joiningAvailability)}`);
console.log(`Total experience: ${profile.totalExperienceYears === undefined ? "UNKNOWN" : `${profile.totalExperienceYears} years`}`);
