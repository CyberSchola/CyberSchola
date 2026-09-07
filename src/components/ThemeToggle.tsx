"use client";
import { useEffect, useState } from "react";
import { FaMoon, FaSun } from "react-icons/fa";

const THEME_KEY = "sma_theme";

/**
 * ThemeToggle Component
 *
 * Handles switching between light and dark themes.
 * Persists choice to localStorage so it persists across page reloads.
 *
 * How it works:
 * 1. On mount: Read current theme from DOM (already set by head script)
 * 2. When user clicks toggle: Switch theme, update DOM and localStorage
 * 3. On page reload: Head script in layout reads localStorage and applies theme
 *
 * The head script in layout.tsx handles initialization to prevent theme flash.
 * This component only handles user interactions and persistence.
 */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<string>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // On mount, read current theme from DOM (set by head script)
    try {
      const isDarkMode = document.documentElement.classList.contains("dark");
      setTheme(isDarkMode ? "dark" : "light");
    } catch (e) {
      console.error("Theme initialization error:", e);
      setTheme("light");
    }
    setMounted(true);
  }, []);

  useEffect(() => {
    // When theme changes, update DOM and localStorage
    if (!mounted) return;

    const root = document.documentElement;

    // Update DOM
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }

    // Persist to localStorage for next page load
    try {
      localStorage.setItem(THEME_KEY, theme);
      console.log(`Theme saved to localStorage: ${theme}`);
    } catch (e) {
      console.error("Failed to save theme to localStorage:", e);
    }
  }, [theme, mounted]);

  /**
   * Toggle between light and dark themes
   */
  const toggle = () => {
    setTheme((prevTheme) => (prevTheme === "dark" ? "light" : "dark"));
  };

  // Don't render until mounted to avoid hydration mismatch
  if (!mounted) {
    return (
      <button
        aria-label="Toggle theme"
        disabled
        className="bg-white dark:bg-gray-800 rounded-full w-8 h-8 flex items-center justify-center cursor-pointer opacity-50 transition-all duration-300"
        title="Dark / Light mode"
      >
        <FaMoon className="text-gray-600" size={16} />
      </button>
    );
  }

  return (
    <div className="group relative">
      <button
        aria-label="Toggle theme"
        onClick={toggle}
        className="bg-white dark:bg-gray-800 rounded-full w-8 h-8 flex items-center justify-center cursor-pointer transition-all duration-300 transform hover:scale-110 hover:shadow-lg dark:hover:shadow-yellow-500/30 hover:bg-yellow-50 dark:hover:bg-gray-700 active:scale-95"
      >
        {theme === "dark" ? (
          <FaSun
            className="text-yellow-400 transition-all duration-300 animate-spin-slow"
            size={16}
          />
        ) : (
          <FaMoon
            className="text-gray-600 transition-all duration-300 animate-spin-slow"
            size={16}
          />
        )}
      </button>
      {/* TOOLTIP */}
      <div className="absolute top-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap pointer-events-none">
        {theme === "dark" ? "Light mode" : "Dark mode"}
      </div>

      {/* ANIMATIONS STYLES */}
      <style jsx>{`
        @keyframes spin-slow {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(180deg);
          }
        }
        button:hover :global(svg) {
          animation: spin-slow 0.6s ease-in-out;
        }
      `}</style>
    </div>
  );
}
