"use client";
import React, { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import MobileMenuDrawer from "@/components/MobileMenuDrawer";
import Navbar from "@/components/Navbar";

interface DashboardShellProps {
  children: React.ReactNode;
  onShowLoader?: () => void;
  lastPath?: string;
}

const DashboardShell: React.FC<DashboardShellProps> = ({
  children,
  onShowLoader,
  lastPath = "",
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const pathname = usePathname();

  return (
    <>
      <MobileMenuDrawer
        open={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        onShowLoader={onShowLoader}
        lastPath={lastPath}
      />
      <div className="flex-1 flex flex-col">
        <Navbar onMenuClick={() => setMobileMenuOpen(true)} />
        {children}
        <div className="flex items-center justify-center mt-6 text-xs text-gray-400">
          &copy; {new Date().getFullYear()} Smart Schooling All rights reserved.
          Developed by Patrick U. Nnodu
        </div>
      </div>
    </>
  );
};

export default DashboardShell;
