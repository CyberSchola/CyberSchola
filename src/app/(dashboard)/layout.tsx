"use client";
import React, { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import Menu from "@/components/Menu";
import LogoLink from "@/components/LogoLink";
import DashboardShell from "@/components/DashboardShell";
import PageLoader from "@/components/PageLoader";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isLoading, setIsLoading] = useState(false);
  const [lastPath, setLastPath] = useState<string>("");
  const pathname = usePathname();

  // Smart loading logic: only show loader when navigating to a NEW page or when pathname changes
  useEffect(() => {
    // If we've changed to a different path, hide the loader after short delay (page has loaded)
    if (pathname && pathname !== lastPath) {
      setIsLoading(false);
      setLastPath(pathname);
    }
  }, [pathname, lastPath]);

  const handleShowLoader = () => {
    // Only show loader if we're not already on the same page
    // This will be checked in Menu component before calling this
    setIsLoading(true);
  };

  return (
    <div className="flex h-full">
      {/* Sidebar: hidden on small and md screens, visible lg+ */}
      <div className="hidden lg:w-[16%] xl:w-[14%] lg:block lg:p-4 bg-white dark:bg-gray-900">
        <LogoLink />
        <Menu onShowLoader={handleShowLoader} lastPath={lastPath} />
      </div>

      {/* Client shell contains mobile menu state and navbar - takes remaining space */}
      <DashboardShell onShowLoader={handleShowLoader} lastPath={lastPath}>
        <div className="relative flex-1">
          {isLoading && <PageLoader />}
          {!isLoading && children}
        </div>
      </DashboardShell>

      <Analytics />
      <SpeedInsights />
    </div>
  );
}
