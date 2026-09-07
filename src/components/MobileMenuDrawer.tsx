"use client";
import React, { useEffect } from "react";
import Image from "next/image";
import Menu from "@/components/Menu";

interface Props {
  open: boolean;
  onClose: () => void;
  onShowLoader?: () => void;
  lastPath?: string;
}

const MobileMenuDrawer: React.FC<Props> = ({
  open,
  onClose,
  onShowLoader,
  lastPath = "",
}) => {
  // Prevent background scroll when drawer is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Overlay with fade animation */}
      <div
        className="absolute inset-0 bg-black bg-opacity-40 animate-fade-in"
        onClick={onClose}
      />
      {/* Drawer with slide-in animation */}
      <div className="relative w-64 max-w-[80vw] h-full bg-white dark:bg-gray-900 shadow-lg flex flex-col p-4 animate-drawer-slide-in">
        {/* Logo and close button - show brand text on mobile */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Image src="/logo.png" alt="logo" width={32} height={32} />
            <span className="font-bold text-lg dark:text-white">
              SmartSchool
            </span>
          </div>
          <button
            onClick={onClose}
            aria-label="Close menu"
            className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors"
          >
            <svg
              width="24"
              height="24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="dark:text-gray-300"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        {/* Menu with icons and text always visible */}
        <div className="flex-1 overflow-y-auto">
          <Menu
            showLabels={true}
            onItemClick={onClose}
            onShowLoader={onShowLoader}
            lastPath={lastPath}
          />
        </div>

        {/* ANIMATIONS STYLES */}
        <style jsx>{`
          @keyframes fade-in {
            from {
              opacity: 0;
            }
            to {
              opacity: 1;
            }
          }
          @keyframes drawer-slide-in {
            from {
              transform: translateX(-100%);
            }
            to {
              transform: translateX(0);
            }
          }
          :global(.animate-fade-in) {
            animation: fade-in 0.3s ease-in-out;
          }
          :global(.animate-drawer-slide-in) {
            animation: drawer-slide-in 0.3s ease-in-out;
          }
        `}</style>
      </div>
    </div>
  );
};

export default MobileMenuDrawer;
