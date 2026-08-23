import { rm } from "node:fs/promises";
import path from "node:path";

const cacheDirectory = path.resolve(".cache");
await rm(cacheDirectory, { recursive: true, force: true });
console.log("Cache cleared successfully.");
