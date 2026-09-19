# CyberSchola demo frontend

The hackathon demo's user interface, live at https://app-cyberschola.ibraheembello.com.

It is a demo surface, not the product frontend. The product frontend is the Next.js
application at the repository root, owned by the frontend engineers; the screens and
flows here are a reference for it.

## What it does

- Sign in as a demo person (administrator, two teachers, a pupil) with a real, signed,
  one-hour token from the staging demo sign-in.
- Role-aware navigation, with locked "Coming Soon" items for the wider platform.
- Administrator: dashboard, students (add, edit, delete), teachers, results, attendance,
  and the Admin Copilot.
- Teacher: dashboard, their pupils, results, and the Teacher Copilot.
- Pupil: their own results.

Every screen calls the CyberSchola API with the signed-in person's token, so it shows
exactly what the backend authorizes. Hiding a menu item here is presentation only.

## How it is built and served

Plain HTML, CSS and JavaScript: no build step and no dependencies, so nothing is
installed. Nginx serves the three files and proxies `/api` and `/demo-auth` to the API
and the demo sign-in on the same server, so the browser talks to one origin and no CORS
is needed. The site configuration is `backend/deploy/staging/nginx-app.conf.template`.

To deploy a change, copy the files into the web root on the staging server
(`/var/www/cyberschola-app`). Nginx serves them with `Cache-Control: no-cache`, so the
next page load picks them up.

## Depends on

- `GET /api/v1/results/performance` (results).
- `POST /api/v1/ai/admin/performance`, `GET /api/v1/ai/teacher/assignments` and
  `POST /api/v1/ai/teacher/lesson-plan` (the Copilots). Until those are deployed the
  Copilot screens show the API's error message and a Retry button.
