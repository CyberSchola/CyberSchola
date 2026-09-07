/**
 * ROUTE PROTECTOR: Client-Side Route Protection Component
 *
 * This component provides UI-level authentication protection by:
 * 1. Checking if user is authenticated with Clerk on the client side
 * 2. Hiding protected route content while auth state is being loaded
 * 3. Redirecting unauthenticated users to /sign-in page
 * 4. Preventing flash of unauthorized content
 *
 * This works in tandem with server-side middleware.ts for defense-in-depth:
 * - middleware.ts: Server-side protection (edge level)
 * - RouteProtector: Client-side protection (UI level)
 *
 * Why both are needed:
 * - Middleware protects before page renders (faster, more secure)
 * - RouteProtector improves UX by preventing content flash
 * - Clerk integration requires both for complete auth flow
 */

"use client";
import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@clerk/nextjs";

/**
 * List of routes that require authentication.
 * Users accessing these routes must be logged in with Clerk.
 *
 * These should match the protected routes in middleware.ts for consistency.
 */
const PROTECTED_ROUTES = [
  "/admin", // Admin dashboard
  "/teacher", // Teacher dashboard
  "/student", // Student dashboard
  "/parent", // Parent dashboard
  "/list", // Management lists (classes, students, results, etc.)
  "/profile", // User profile pages
  "/settings", // User settings pages
  "/logout", // Logout functionality
];

/**
 * Checks if a given pathname is a protected route.
 *
 * @param {string} pathname - The URL pathname to check
 * @returns {boolean} True if the route requires authentication
 *
 * Example:
 * - isProtectedRoute("/admin/dashboard") → true (starts with "/admin")
 * - isProtectedRoute("/student/grades") → true (starts with "/student")
 * - isProtectedRoute("/") → false (not protected)
 */
function isProtectedRoute(pathname: string): boolean {
  return PROTECTED_ROUTES.some((route) => pathname.startsWith(route));
}

/**
 * RouteProtector Component
 *
 * Props:
 * @param {React.ReactNode} children - The page content to protect
 *
 * How it works:
 * 1. On mount: Checks Clerk's auth state using useAuth() hook
 * 2. If accessing public route: Immediately shows content (no auth check)
 * 3. If accessing protected route AND not authenticated: Redirects to /sign-in
 * 4. If accessing protected route AND authenticated: Shows content
 * 5. While loading: Returns null to prevent content flash
 *
 * State:
 * - isLoaded: Clerk finished loading user data
 * - userId: The authenticated user's ID (null if not authenticated)
 * - isReady: Local state tracking if auth check is complete for this route
 */
export default function RouteProtector({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { isLoaded, userId } = useAuth();
  const [isReady, setIsReady] = useState(false);

  /**
   * useEffect: Main authentication check logic
   *
   * Runs whenever: pathname, router, isLoaded, or userId changes
   *
   * Flow:
   * 1. Wait for Clerk to load (isLoaded = true)
   * 2. If public route or no pathname: mark as ready immediately
   * 3. If protected route:
   *    - Check if user is authenticated (userId exists)
   *    - If not authenticated: redirect to /sign-in
   *    - If authenticated: mark as ready to show content
   *
   * Why wait for isLoaded:
   * - Clerk needs time to verify the session token from cookies
   * - Checking auth before isLoaded would always redirect (false positive)
   *
   * Why return early from redirect:
   * - Router.push() is asynchronous
   * - Prevents marking as ready while redirect is happening
   */
  useEffect(() => {
    // Step 1: Wait for Clerk to finish loading authentication state
    if (!isLoaded) return;

    // Step 2: Check if this route requires authentication
    // Only check on client side after hydration (pathname could be null during SSR)
    if (!pathname || !isProtectedRoute(pathname)) {
      // Public route - no auth check needed, show content immediately
      setIsReady(true);
      return;
    }

    // Step 3: This is a protected route - check if user is authenticated
    if (!userId) {
      // User is not authenticated, redirect to sign-in page
      // Clerk middleware will also catch this, but this provides immediate UX feedback
      router.push("/sign-in");
      return;
    }

    // Step 4: User is authenticated and route is protected - show content
    setIsReady(true);
  }, [pathname, router, isLoaded, userId]);

  /**
   * Render Logic:
   *
   * If this is a protected route AND we haven't verified auth yet:
   * - Return null to prevent showing unauthorized content
   * - This creates a brief pause where nothing renders
   * - Once isReady becomes true, content will be shown (or redirected)
   *
   * This prevents the "flash" of protected content before redirect happens.
   */
  if (pathname && isProtectedRoute(pathname) && !isReady) {
    return null;
  }

  // All checks passed - render the children (page content)
  return <>{children}</>;
}
