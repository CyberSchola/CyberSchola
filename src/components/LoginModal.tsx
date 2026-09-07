"use client";
import React, { useEffect, useState } from "react";
import * as Clerk from "@clerk/elements/common";
import * as SignIn from "@clerk/elements/sign-in";
import { useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { FaUser, FaLock } from "react-icons/fa";

/**
 * LOGIN MODAL: Professional Sign-in Component
 *
 * Features:
 * - Responsive design (works from 425px up)
 * - Professional styling with glassmorphism
 * - Loading spinner on submit
 * - Input icons for visual clarity
 * - Smooth animations and transitions
 * - Dark mode support
 * - Auto-redirect on successful sign-in
 */
const LoginModal = () => {
  const { isSignedIn, user, isLoaded } = useUser();
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Redirect if already signed in
  useEffect(() => {
    const role = user?.publicMetadata.role;

    if (role) {
      router.push(`/${role}`);
    }
  }, [user, router]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <SignIn.Root>
        <SignIn.Step name="start">
          <div className="relative w-full max-w-sm sm:max-w-md">
            {/* MAIN CARD */}
            <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border border-white/30 dark:border-gray-700/30 rounded-3xl p-6 sm:p-8 shadow-2xl overflow-hidden">
              {/* HEADER */}
              <div className="flex items-start gap-3 sm:gap-4 mb-6 sm:mb-8">
                {/* LOGO */}
                <div className="flex-shrink-0 w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-gradient-to-br from-indigo-600 via-indigo-500 to-blue-400 flex items-center justify-center text-white text-base sm:text-lg font-bold shadow-lg">
                  SS
                </div>

                {/* TEXT */}
                <div className="flex-1 min-w-0">
                  <h2 className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent">
                    Welcome back
                  </h2>
                  <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mt-1">
                    Sign in to access your dashboard
                  </p>
                </div>
              </div>

              {/* ERROR MESSAGES */}
              <div className="mb-4">
                <Clerk.GlobalError className="text-xs sm:text-sm text-red-500 bg-red-50 dark:bg-red-900/20 p-3 rounded-lg" />
              </div>

              {/* FORM FIELDS */}
              <div className="space-y-4 sm:space-y-5">
                {/* USERNAME FIELD */}
                <Clerk.Field name="identifier">
                  <Clerk.Label className="block text-xs sm:text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    Username or Email
                  </Clerk.Label>
                  <div className="relative">
                    <FaUser className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 text-sm" />
                    <Clerk.Input
                      type="text"
                      className="w-full pl-9 sm:pl-11 pr-4 py-2.5 sm:py-3 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm sm:text-base text-gray-900 dark:text-gray-50 placeholder-gray-400 dark:placeholder-gray-500 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white dark:focus:bg-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                      placeholder="Enter your username or email"
                    />
                  </div>
                  <Clerk.FieldError className="text-xs sm:text-sm text-red-500 mt-1.5" />
                </Clerk.Field>

                {/* PASSWORD FIELD */}
                <Clerk.Field name="password">
                  <Clerk.Label className="block text-xs sm:text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    Password
                  </Clerk.Label>
                  <div className="relative">
                    <FaLock className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 text-sm" />
                    <Clerk.Input
                      type="password"
                      required
                      className="w-full pl-9 sm:pl-11 pr-4 py-2.5 sm:py-3 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm sm:text-base text-gray-900 dark:text-gray-50 placeholder-gray-400 dark:placeholder-gray-500 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white dark:focus:bg-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                      placeholder="Enter your password"
                    />
                  </div>
                  <Clerk.FieldError className="text-xs sm:text-sm text-red-500 mt-1.5" />
                </Clerk.Field>
              </div>

              {/* SUBMIT BUTTON WITH SPINNER */}
              <SignIn.Action
                submit
                onClick={() => setIsSubmitting(true)}
                className="w-full mt-6 sm:mt-8 relative inline-flex items-center justify-center px-4 py-2.5 sm:py-3 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white text-sm sm:text-base font-semibold rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {/* SPINNER */}
                {isSubmitting && (
                  <span className="absolute inset-0 flex items-center justify-center">
                    <svg
                      className="w-5 h-5 animate-spin"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                  </span>
                )}

                {/* TEXT */}
                <span className={isSubmitting ? "opacity-0" : "opacity-100"}>
                  Sign In
                </span>
              </SignIn.Action>

              {/* DIVIDER */}
              <div className="mt-6 sm:mt-8 pt-6 sm:pt-8 border-t border-gray-200 dark:border-gray-700/50 text-center">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  &copy; {new Date().getFullYear()} Smart Schooling Management
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  All rights reserved
                </p>
              </div>
            </div>

            {/* GRADIENT DECORATION */}
            <div
              className="absolute -bottom-8 left-1/2 -translate-x-1/2 w-48 sm:w-64 h-8 rounded-t-full bg-gradient-to-r from-indigo-400 to-blue-300 opacity-20 blur-2xl"
              aria-hidden
            />
          </div>
        </SignIn.Step>
      </SignIn.Root>
    </div>
  );
};

export default LoginModal;
