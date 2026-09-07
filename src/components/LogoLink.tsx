"use client"
import Image from "next/image"
import { useRouter } from "next/navigation"
import React from "react"
import { getRole, isAuthenticated } from "@/lib/auth"

// LogoLink: a small client component used in the dashboard layout.
// Behavior:
// - If the demo user is authenticated (isAuthenticated() === true), clicking
//   the logo navigates to '/{role}', e.g. '/teacher'.
// - Otherwise it navigates to the public home page '/'.
// This prevents the previous behavior where clicking the logo could appear
// to reset context or navigate away from the user's dashboard.
const LogoLink: React.FC = () => {
  const router = useRouter()

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    if (isAuthenticated()) {
      const role = getRole() || ""
      // Navigate to the role dashboard, fallback to '/' if role missing
      router.push(role ? `/${role}` : "/")
    } else {
      router.push("/")
    }
  }

  return (
    //  I used a button-like anchor to allow client-side navigation logic.
    <a onClick={handleClick} className=" flex items-center justify-center lg:justify-start gap-2 cursor-pointer" aria-label="SmartSchool home">
      <Image src="/logo.png" alt="logo" width={32} height={32} />
      <span className=" hidden lg:block font-bold ">SmartSchool</span>
    </a>
  )
}

export default LogoLink
