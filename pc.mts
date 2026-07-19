import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./src/generated/prisma/client";
const p = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const n = await p.transformer.count({ where: { dataSource: "INSPECTION_REGISTER" } });
console.log(n);
await p.$disconnect();
