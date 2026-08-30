import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

function databaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) throw new Error("DATABASE_URL is required for persistent application tracking.");
  return value;
}

const globalForPrisma = globalThis as unknown as { jobAgentPrisma?: PrismaClient };

export const prisma = globalForPrisma.jobAgentPrisma ?? new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl() }),
});

if (process.env.NODE_ENV !== "production") globalForPrisma.jobAgentPrisma = prisma;

export type DatabaseClient = PrismaClient;
