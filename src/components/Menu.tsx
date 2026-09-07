"use client";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useClerk } from "@clerk/nextjs";
import { getRole, isAuthenticated, clearAuth } from "@/lib/auth";
import { role as demoRole } from "@/lib/data";
import { IconType } from "react-icons";
import {
  FaChalkboardTeacher,
  FaUserGraduate,
  FaUsers,
  FaBook,
  FaLayerGroup,
  FaClipboard,
  FaFileAlt,
  FaClipboardList,
  FaChartBar,
  FaCheckSquare as FaCheckSquareFA,
  FaCalendarAlt,
  FaEnvelope,
  FaBullhorn,
  FaVideo,
  FaUser,
  FaHome,
  FaCog,
  FaSignOutAlt,
} from "react-icons/fa";

/* MENU ITEM STRUCTURE */
type MenuItem = {
  icon?: IconType;
  label: string;
  href: string;
  visible: string[];
};

const menuItems: { title: string; items: MenuItem[] }[] = [
  {
    title: "MENU",
    items: [
      {
        icon: FaHome,
        label: "Home",
        href: "/",
        visible: ["admin", "teacher", "student", "parent"],
      },
      {
        icon: FaChalkboardTeacher,
        label: "Teachers",
        href: "/list/teachers",
        visible: ["admin", "teacher"],
      },
      {
        icon: FaUserGraduate,
        label: "Students",
        href: "/list/students",
        visible: ["admin", "teacher"],
      },
      {
        icon: FaUsers,
        label: "Parents",
        href: "/list/parents",
        visible: ["admin", "teacher"],
      },
      {
        icon: FaBook,
        label: "Subjects",
        href: "/list/subjects",
        visible: ["admin"],
      },
      {
        icon: FaLayerGroup,
        label: "Classes",
        href: "/list/classes",
        visible: ["admin", "teacher"],
      },
      {
        icon: FaClipboard,
        label: "Lessons",
        href: "/list/lessons",
        visible: ["admin", "teacher"],
      },
      {
        icon: FaFileAlt,
        label: "Exams",
        href: "/list/exams",
        visible: ["admin", "teacher", "student", "parent"],
      },
      {
        icon: FaClipboardList,
        label: "Assignments",
        href: "/list/assignments",
        visible: ["admin", "teacher", "student", "parent"],
      },
      {
        icon: FaChartBar,
        label: "Results",
        href: "/list/results",
        visible: ["admin", "teacher", "student", "parent"],
      },
      {
        icon: FaCheckSquareFA,
        label: "Attendance",
        href: "/list/attendance",
        visible: ["admin", "teacher", "student", "parent"],
      },
      {
        icon: FaCalendarAlt,
        label: "Events",
        href: "/list/events",
        visible: ["admin", "teacher", "student", "parent"],
      },
      {
        icon: FaEnvelope,
        label: "Messages",
        href: "/list/messages",
        visible: ["admin", "teacher", "student", "parent"],
      },
      {
        icon: FaBullhorn,
        label: "Announcements",
        href: "/list/announcements",
        visible: ["admin", "teacher", "student", "parent"],
      },
      {
        icon: FaVideo,
        label: "Live Class",
        href: "/list/liveclass",
        visible: ["admin", "teacher", "student", "parent"],
      },
    ],
  },
  {
    title: "OTHER",
    items: [
      {
        icon: FaUser,
        label: "Profile",
        href: "/profile",
        visible: ["admin", "teacher", "student", "parent"],
      },
      {
        icon: FaCog,
        label: "Settings",
        href: "/settings",
        visible: ["admin", "teacher", "student", "parent"],
      },
      {
        icon: FaSignOutAlt,
        label: "Logout",
        href: "/logout",
        visible: ["admin", "teacher", "student", "parent"],
      },
    ],
  },
];

interface MenuProps {
  showLabels?: boolean;
  onItemClick?: () => void;
  onShowLoader?: () => void;
  lastPath?: string;
}

const Menu: React.FC<MenuProps> = ({
  showLabels = false,
  onItemClick,
  onShowLoader,
  lastPath = "",
}) => {
  const router = useRouter();
  const pathname = usePathname();
  const { signOut } = useClerk();
  const [currentRole, setCurrentRole] = useState<string | null>(null);
  const [pendingClose, setPendingClose] = useState<string | null>(null);

  useEffect(() => {
    // Read the persisted demo role (if any) so the menu can decide where
    // "Home" should navigate. We also listen for the custom storage event
    // 'sma_auth_change' which is emitted by the auth helper to react to
    // sign-in / sign-out in other parts of the app.
    const update = () => setCurrentRole(isAuthenticated() ? getRole() : null);
    update();
    window.addEventListener("sma_auth_change", update);
    return () => window.removeEventListener("sma_auth_change", update);
  }, []);

  // Close the drawer only after navigation finishes and the pathname
  // matches the item that was clicked. This prevents the drawer closing
  // immediately before the new page has rendered (which felt too fast).
  useEffect(() => {
    if (!pendingClose || !pathname) return;
    if (pathname === pendingClose || pathname.startsWith(pendingClose + "/")) {
      onItemClick?.();
      setPendingClose(null);
    }
  }, [pathname, pendingClose, onItemClick]);

  return (
    /* MENU  MAIN CONTAINER*/
    <div className=" mt-4 text-sm ">
      {/* MENU STRUCTURE */}
      {menuItems.map((i) => (
        /* MENU ICON AND LABEL CONTAINER */
        <div className=" flex flex-col gap-2" key={i.title}>
          {/* MENU TITLES */}
          <span className=" hidden lg:block text-gray-400 font-light my-4">
            {i.title}
          </span>

          {/* ICON IMAGE and  STRUCTURE CONTAINER */}
          {i.items.map((item) => {
            // check the static demo role from data.ts first, if it matches
            // the visible list. I then further allow the persisted current
            // auth role (from localStorage via getRole()) to affect Home and
            // Logout behavior at click-time.
            if (item.visible.includes(demoRole)) {
              // Special-case "Home": when the user is signed in I don't
              // want to navigate back to the public home page ("/"), which
              // in the prior implementation could act like a sign-out or
              // remove the current context. Instead, route the user to the
              // dashboard for their role.
              if (item.label === "Home") {
                const handleHome = (e: React.MouseEvent) => {
                  e.preventDefault();
                  const targetPath = currentRole
                    ? `/${currentRole}`
                    : item.href;
                  // Only show loader if navigating to a different page
                  if (targetPath !== lastPath) {
                    onShowLoader?.();
                  }
                  // Defer closing until navigation finishes
                  setPendingClose(targetPath);
                  if (currentRole) {
                    // route to the authenticated user's dashboard
                    router.push(`/${currentRole}`);
                  } else {
                    // no authenticated role: go to public homepage
                    router.push(item.href);
                  }
                };

                return (
                  <a
                    key={item.label}
                    onClick={handleHome}
                    className={`flex items-center ${
                      showLabels
                        ? "justify-start"
                        : "justify-center lg:justify-start"
                    } gap-4 text-gray-500 py-2 md:px-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer`}
                  >
                    {item.icon ? <item.icon size={20} /> : null}
                    <span className={showLabels ? "block" : "hidden lg:block"}>
                      {item.label}
                    </span>
                  </a>
                );
              }

              // Special-case "Logout": Use Clerk to sign out and redirect to sign-in
              if (item.label === "Logout") {
                const handleLogout = async (e: React.MouseEvent) => {
                  e.preventDefault();
                  try {
                    // Clear demo auth state
                    clearAuth();
                    // Sign out from Clerk
                    await signOut({ redirectUrl: "/" });
                  } catch (error) {
                    console.error("Logout error:", error);
                    // Redirect anyway
                    router.push("/");
                  }
                };

                return (
                  <a
                    key={item.label}
                    onClick={handleLogout}
                    className={`flex items-center ${
                      showLabels
                        ? "justify-start"
                        : "justify-center lg:justify-start"
                    } gap-4 text-gray-500 py-2 md:px-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer`}
                  >
                    {item.icon ? <item.icon size={20} /> : null}
                    <span className={showLabels ? "block" : "hidden lg:block"}>
                      {item.label}
                    </span>
                  </a>
                );
              }

              // Default rendering for other menu items: I used Link so Next can
              // prefetch and perform client navigation.
              return (
                <Link
                  href={item.href}
                  key={item.label}
                  onClick={() => {
                    // Only show loader if navigating to a different page
                    if (item.href !== lastPath) {
                      onShowLoader?.();
                    }
                    setPendingClose(item.href);
                  }}
                  className={`flex items-center ${
                    showLabels
                      ? "justify-start"
                      : "justify-center lg:justify-start"
                  } gap-4 text-gray-500 py-2 md:px-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors duration-200`}
                >
                  {item.icon ? (
                    <span className="inline-flex">
                      <item.icon size={20} />
                    </span>
                  ) : null}
                  <span className={showLabels ? "block" : "hidden lg:block"}>
                    {item.label}
                  </span>
                </Link>
              );
            }
          })}
        </div>
      ))}
    </div>
  );
};

export default Menu;
