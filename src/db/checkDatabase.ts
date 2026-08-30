import { prisma } from "./prisma.js";

try {
  await prisma.$queryRaw`SELECT 1`;
  console.log("Database connection: OK");
} finally {
  await prisma.$disconnect();
}
