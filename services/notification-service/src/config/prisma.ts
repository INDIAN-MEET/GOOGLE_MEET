import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client.ts";
import { env } from "./env.ts";


/**
 * Prisma 7 requires a driver adapter. PrismaPg talks to Postgres through
 * the standard `pg` driver using the DATABASE_URL connection string.
 */
const adapter = new PrismaPg({ connectionString: env.databaseUrl });

/** Shared Prisma client. Import this instead of creating new clients. */
export const prisma = new PrismaClient({ adapter });