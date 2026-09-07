"use client";
import React from "react";
import { useRouter } from "next/navigation";
import { useClerk } from "@clerk/nextjs";
import { FaSignOutAlt } from "react-icons/fa";

/**
 * ClerkSignOutButton: Handles Clerk sign-out with immediate redirect
 * When clicked, it signs out the user and immediately redirects to /sign-in
 */
const ClerkSignOutButton = () => {
  const { signOut } = useClerk();
  const router = useRouter();

  const handleSignOut = async () => {
    try {
      // Sign out from Clerk
      await signOut();
      // Immediately redirect to sign-in page
      router.push("/sign-in");
    } catch (error) {
      console.error("Sign-out error:", error);
      // Redirect anyway in case of error
      router.push("/sign-in");
    }
  };

  return (
    <button
      onClick={handleSignOut}
      className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 rounded-md transition-colors"
    >
      <FaSignOutAlt size={16} />
      <span>Sign Out</span>
    </button>
  );
};

export default ClerkSignOutButton;
