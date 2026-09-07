/**
 * ROOT LAYOUT: Application Root Component
 *
 * This is the outermost layout that wraps every page in the application.
 * All global providers, authentication setup, and theme initialization happen here.
 *
 * Component Tree:
 * ClerkProvider (Clerk auth context)
 *   ↓
 * html / body (DOM structure)
 *   ↓
 * RouteProtector (Client-side route protection)
 *   ↓
 * Page Content (children)
 *
 * Key Responsibilities:
 * 1. Provide Clerk authentication context to entire app
 * 2. Initialize theme preference from localStorage
 * 3. Protect routes from unauthorized access
 * 4. Include analytics and performance monitoring
 */

import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { ClerkProvider } from "@clerk/nextjs";
import RouteProtector from "@/components/RouteProtector";

/**
 * Load Inter font from Google Fonts
 * Used as default font for the entire application
 */
const inter = Inter({ subsets: ["latin"] });

/**
 * SEO Metadata for the application
 * These tags appear in the HTML head and affect search results
 */
export const metadata: Metadata = {
  title: "Pato Smart Schooling Management Web-Application",
  description: "Next.js School Management System",
  authors: [{ name: "Patrick Nnodu", url: "https://github.com/Dalentin1" }],
  applicationName: "Smart Schooling Management Application",
  keywords: ["nextjs", "react", "typescript", "school management application"],
  generator: "Next.js",
};

/**
 * RootLayout Component
 *
 * This is a Server Component that wraps all pages.
 * It initializes:
 * - Clerk authentication provider
 * - DOM structure (html, body)
 * - Route protection
 * - Theme initialization
 * - Analytics tracking
 *
 * The RouteProtector is placed INSIDE html/body to ensure:
 * - html and body tags are always present in the DOM
 * - No "missing root layout tags" error when auth checking
 * - Clean redirect to /sign-in without error pages showing
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      {/* HTML root element with English language */}
      <html lang="en" suppressHydrationWarning>
        {/* HEAD: Include critical theme script before any content renders */}
        <head>
          {/* 
            THEME INITIALIZATION SCRIPT (Critical - runs before React)
            
            This script MUST run before the page renders to prevent theme flash.
            It runs synchronously in the HTML head, before any React hydration.
            
            How it works:
            1. Checks localStorage for saved theme preference ('sma_theme')
            2. Applies 'dark' class to <html> if user prefers dark mode
            3. Hides body while theme applies (prevents visible flash)
            4. Shows body after theme is applied
            
            Why in head?
            - Runs immediately as page loads
            - Blocks rendering until theme is applied
            - No flash of wrong theme
            - User always sees the correct theme from the start
          */}
          <script
            dangerouslySetInnerHTML={{
              __html: `
            (function(){
              try {
                // Get user's saved theme preference from localStorage
                var savedTheme = localStorage.getItem('sma_theme');
                
                // Default to 'light' if no preference saved
                var theme = (savedTheme === 'dark') ? 'dark' : 'light';
                
                // Apply theme immediately by adding class to <html>
                if (theme === 'dark') {
                  document.documentElement.classList.add('dark');
                }
                
                // Ensure localStorage has the correct value
                localStorage.setItem('sma_theme', theme);
                
                // Mark that we've applied the theme (prevent FOUC - Flash of Unstyled Content)
                document.documentElement.setAttribute('data-theme-applied', 'true');
              } catch(e) {
                // If localStorage fails, just continue with light theme
                console.error('Theme script error:', e);
              }
            })();
          `,
            }}
          />
        </head>
        {/* Body with Inter font applied globally */}
        <body className={inter.className}>
          {/* 
            RouteProtector: Client-side route protection
            
            Located INSIDE body to:
            - Prevent "missing html/body tags" error
            - Always maintain valid DOM structure
            - Safely hide content while checking auth
            - Redirect cleanly without error pages
            
            If user lacks auth for protected route:
            - Returns null (renders nothing)
            - Middleware redirects to /sign-in
            - No error page flashes
          */}
          <RouteProtector>
            {/* Page content injected here by Next.js routing */}
            {children}

            {/**
             * Vercel Analytics Integration
             * Tracks user interactions and performance metrics
             */}
            <Analytics />

            {/**
             * Vercel Speed Insights
             * Monitors Core Web Vitals and performance
             */}
            <SpeedInsights />
          </RouteProtector>
        </body>
      </html>
    </ClerkProvider>
  );
}
