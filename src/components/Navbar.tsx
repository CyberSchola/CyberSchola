"use client";
import { useEffect, useState } from "react";
import { getRole } from "@/lib/auth";
import { FaBell, FaEnvelope, FaSearch, FaCog } from "react-icons/fa";
import ThemeToggle from "./ThemeToggle";
import { UserButton } from "@clerk/nextjs";

interface NavbarProps {
  onMenuClick?: () => void;
}

/**
 * NAVBAR: Top Navigation Component
 *
 * Features:
 * - Responsive design with mobile menu button
 * - Search bar on medium screens and up
 * - Animated interactive icons (messages, notifications, settings)
 * - Professional hover and click animations
 * - Theme toggle
 * - User profile section
 * - Badge notification counter
 */
const Navbar: React.FC<NavbarProps> = ({ onMenuClick }) => {
  const [role, setRole] = useState<string | null>(() => getRole());
  const [activeIcon, setActiveIcon] = useState<string | null>(null);

  useEffect(() => {
    const onAuthChange = () => setRole(getRole());
    window.addEventListener("sma_auth_change", onAuthChange);
    return () => window.removeEventListener("sma_auth_change", onAuthChange);
  }, []);

  const roleLabel = role
    ? `${role.charAt(0).toUpperCase()}${role.slice(1)}`
    : "Admin";

  /**
   * Handle icon click - trigger animation
   */
  const handleIconClick = (iconName: string): void => {
    setActiveIcon(iconName);
    setTimeout(() => setActiveIcon(null), 600);
  };

  return (
    <>
      <div className="flex items-center justify-between p-4">
        {/* Menu button for small screens */}
        <button
          className="lg:hidden p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 mr-2 transition-colors duration-200"
          aria-label="Open menu"
          onClick={onMenuClick}
        >
          <svg
            width="28"
            height="28"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-gray-700 dark:text-gray-300"
          >
            <line x1="4" y1="8" x2="24" y2="8" />
            <line x1="4" y1="16" x2="24" y2="16" />
            <line x1="4" y1="24" x2="24" y2="24" />
          </svg>
        </button>

        {/* SEARCH BAR */}
        <div className="hidden md:flex items-center gap-2 text-xs rounded-full ring-[1.5px] ring-gray-300 dark:ring-gray-700 px-2 bg-white dark:bg-gray-800">
          <FaSearch className="text-gray-500 dark:text-gray-400" size={14} />
          <input
            type="text"
            placeholder="Search..."
            className="w-[200px] p-2 bg-transparent outline-none text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400"
          />
        </div>

        {/* USER AND ICONS CONTAINER */}
        <div className="flex items-center gap-6 justify-end w-full">
          {/* MESSAGE ICON */}
          <div
            className="group relative"
            onMouseEnter={() => {}}
            onMouseLeave={() => setActiveIcon(null)}
          >
            <button
              onClick={() => handleIconClick("message")}
              className={`bg-white dark:bg-gray-800 rounded-full w-8 h-8 flex items-center justify-center cursor-pointer transition-all duration-300 transform hover:scale-110 hover:shadow-lg dark:hover:shadow-blue-500/30 ${
                activeIcon === "message"
                  ? "scale-90 animate-pulse"
                  : "hover:bg-blue-50 dark:hover:bg-gray-700"
              }`}
              aria-label="Messages"
            >
              <FaEnvelope
                className={`text-gray-600 dark:text-gray-400 transition-all duration-300 ${
                  activeIcon === "message" ? "animate-spin" : ""
                }`}
                size={16}
              />
            </button>
            {/* TOOLTIP */}
            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 px-2 py-1 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap pointer-events-none">
              Messages
            </div>
          </div>

          {/* NOTIFICATION ICON */}
          <div
            className="group relative"
            onMouseEnter={() => {}}
            onMouseLeave={() => setActiveIcon(null)}
          >
            <button
              onClick={() => handleIconClick("notification")}
              className={`bg-white dark:bg-gray-800 rounded-full w-8 h-8 flex items-center justify-center cursor-pointer transition-all duration-300 transform hover:scale-110 hover:shadow-lg dark:hover:shadow-purple-500/30 relative ${
                activeIcon === "notification"
                  ? "scale-90"
                  : "hover:bg-purple-50 dark:hover:bg-gray-700"
              }`}
              title="Notifications"
              aria-label="Notifications"
            >
              <FaBell
                className={`text-gray-600 dark:text-gray-400 transition-all duration-300 ${
                  activeIcon === "notification" ? "animate-bounce" : ""
                }`}
                size={16}
              />
              {/* NOTIFICATION BADGE */}
              <div className="absolute -top-2 -right-2 w-5 h-5 flex items-center justify-center bg-gradient-to-br from-purple-500 to-pink-500 text-white rounded-full text-xs font-bold shadow-lg hover:from-purple-600 hover:to-pink-600 transition-all duration-200">
                1
              </div>
            </button>
            {/* TOOLTIP */}
            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 px-2 py-1 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap pointer-events-none">
              Notifications
            </div>
          </div>

          {/* THEME TOGGLE */}
          <ThemeToggle />

          {/* USER INFO */}
          <div className="flex flex-col text-right">
            <span className="text-xs leading-3 font-bold text-gray-900 dark:text-gray-100">
              Patrick
            </span>
            <span className="text-[10px] text-gray-500 dark:text-gray-400">
              {roleLabel}
            </span>
          </div>

          {/* USER AVATAR */}
          <div
            className="group relative"
            onMouseEnter={() => {}}
            onMouseLeave={() => setActiveIcon(null)}
          >
            <button
              onClick={() => handleIconClick("profile")}
              className={`bg-white dark:bg-gray-800 rounded-full w-9 h-9 flex items-center justify-center cursor-pointer transition-all duration-300 transform hover:scale-110 hover:shadow-lg dark:hover:shadow-indigo-500/30 overflow-hidden ${
                activeIcon === "profile"
                  ? "scale-90"
                  : "hover:bg-indigo-50 dark:hover:bg-gray-700"
              }`}
              aria-label="Profile"
            >
              <UserButton />
            </button>
          </div>
        </div>
      </div>

      {/* ANIMATIONS STYLES */}
      <style jsx>{`
        @keyframes bounce {
          0%,
          100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-4px);
          }
        }
      `}</style>
    </>
  );
};

export default Navbar;
