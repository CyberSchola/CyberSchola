# Smart School Management Application System

## Getting Started

First, run the development server:

```bash / powershell
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js](https://nextjs.org/learn)# SchoolManagementApplication

## Seeding the database (idempotent)

In this project I included an idempotent TypeScript seed script that safely inserts initial data and can be re-run without creating duplicate rows.

- How it works:

  - Bulk inserts use `createMany(..., { skipDuplicates: true })` for speed and idempotency.
  - Lookup records (grades, classes, subjects, teachers, parents, students) are inserted in bulk.
  - Transient records (lessons, exams, assignments, results, attendance, events, announcements) are recreated on each run.

- Run the seed (works across shells including PowerShell on Windows):

```bash / powershell
npm run seed
```

- Notes:
  - The script uses `prisma/seed-runner.js` to register `ts-node` with compatible compiler options on Windows.
  - The seed relies on the `DATABASE_URL` in `.env`. N:B: Make sure it points to a reachable database before running.
  - For heavy seeding it's faster and more reliable to use a local Postgres instance (update `.env` to point to your local DB).
