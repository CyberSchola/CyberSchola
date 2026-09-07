/**
 * MIDDLEWARE: Server-side Route Protection with Clerk
 * 
 * This middleware runs on every request and enforces authentication
 * on protected routes using Clerk's auth system.
 * 
 * Purpose:
 * - Validate user authentication on server-side before rendering pages
 * - Redirect unauthenticated users to /sign-in automatically
 * - Prevent unauthorized access to dashboard routes at the edge
 * 
 * Flow:
 * 1. User requests a protected route (e.g., /admin, /teacher, /student)
 * 2. Middleware intercepts the request
 * 3. Clerk verifies the session token from the request
 * 4. If valid: request continues to the page
 * 5. If invalid: Clerk middleware redirects to /sign-in
 * 
 * Note: Client-side RouteProtector component provides UI-level protection
 * as a complementary safety layer for better UX.
 */

import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

/**
 * PUBLIC_ROUTES: Routes accessible without authentication
 * - "/" (landing page)
 * - "/sign-in" and "/sign-up" (auth pages)
 * - "/api/webhooks/clerk" (webhook endpoint for Clerk events)
 */
const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/webhooks/clerk(.*)",
]);

/**
 * PROTECTED_ROUTES: Routes that require authentication
 * These routes are exclusively for authenticated users:
 * - "/admin(.*)" - Admin dashboard and pages
 * - "/teacher(.*)" - Teacher dashboard and pages
 * - "/student(.*)" - Student dashboard and pages
 * - "/parent(.*)" - Parent dashboard and pages
 * - "/list(.*)" - Management lists (classes, students, results, etc.)
 * - "/profile(.*)" - User profile pages
 * - "/settings(.*)" - User settings pages
 * - "/logout(.*)" - Logout functionality
 */
const isProtectedRoute = createRouteMatcher([
  "/admin(.*)",
  "/teacher(.*)",
  "/student(.*)",
  "/parent(.*)",
  "/list(.*)",
  "/profile(.*)",
  "/settings(.*)",
  "/logout(.*)",
]);

/**
 * Clerk Middleware Handler
 * 
 * This middleware function checks if a request is trying to access
 * a protected route and enforces authentication.
 * 
 * @param {Object} auth - Clerk's auth object containing session data
 * @param {Object} req - The incoming request object
 * 
 * How it works:
 * - If route is NOT protected: allow request to continue (no auth check)
 * - If route IS protected: call auth.protect() which:
 *   a) Checks if user has valid session
 *   b) If valid: allows request to continue
 *   c) If invalid: redirects to /sign-in (Clerk default behavior)
 */
export default clerkMiddleware((auth, req) => {
  // Check if this request is trying to access a protected route
  if (isProtectedRoute(req)) {
    // Enforce authentication - will redirect to /sign-in if not authenticated
    // Using auth.protect() (NOT auth().protect()) - correct Clerk v6 API
    auth.protect();
  }
});

/**
 * MIDDLEWARE CONFIG: Route Matching Patterns
 * 
 * The 'matcher' array tells Next.js which requests should trigger this middleware.
 * This optimizes performance by only running middleware on relevant routes.
 * 
 * First matcher: Runs middleware on protected routes and API routes
 * - (admin|teacher|student|parent|list|profile|settings|logout|api)(.*)
 * 
 * Second matcher: Skips middleware for Next.js internals and static files
 * This prevents unnecessary middleware execution on:
 * - /_next/* (Next.js system files)
 * - Static files: .html, .css, .js, .jpg, .png, .gif, .svg, .woff, etc.
 * - Other system files
 */
export const config = {
  matcher: [
    // Run middleware on protected routes and api routes
    "/(admin|teacher|student|parent|list|profile|settings|logout|api)(.*)",
    // Skip Next.js internals and static files
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
  ],
};
