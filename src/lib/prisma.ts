import { PrismaClient } from "@prisma/client";

const PrismaClientSingleton = () => {
  return new PrismaClient({
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
  });
};

/**********

- Instantiating Prisma Client for development purpose
- In dev. the command npm run clears Node.js cache on the run. This would exhuast DB connections as ech instant     
  hold's it's own pool
- Solution to this is to instantiate a single instance PrismaCilent and save it on the globalThis object. Then we 
  would keep a check to only instantiate PrismaClient if it's not on the globalThis object otherwise use the same 
  instance again

 **********/

declare const globalThis: {
  prismaGlobal: ReturnType<typeof PrismaClientSingleton>;
} & typeof global;

const prisma = globalThis.prismaGlobal ?? PrismaClientSingleton();

export default prisma;

if (process.env.NODE_ENV !== "production") globalThis.prismaGlobal = prisma;
