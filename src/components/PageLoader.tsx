/**
 * PAGE LOADER: Animated Loading Spinner
 *
 * A captivating, professional animated loader for school management app
 * Shows when pages are loading or navigating.
 *
 * Features:
 * - Multiple animated rings (represents school community layers)
 * - Smooth color transitions
 * - Professional and engaging
 * - Responsive design
 * - Works on all screen sizes
 * - Scoped to content area only (doesn't cover navbar/sidebar)
 */

export default function PageLoader() {
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-gradient-to-br from-white/80 via-gray-50/80 to-white/80 dark:from-gray-900/80 dark:via-gray-800/80 dark:to-gray-900/80 backdrop-blur-md rounded-lg">
      {/* OUTER CONTAINER */}
      <div className="flex flex-col items-center justify-center gap-6">
        {/* ANIMATED LOADER */}
        <div className="relative w-20 h-20 sm:w-24 sm:h-24">
          {/* BACKGROUND CIRCLE */}
          <svg
            className="absolute inset-0 w-full h-full"
            viewBox="0 0 100 100"
            xmlns="http://www.w3.org/2000/svg"
          >
            {/* OUTER RING - Rotates clockwise */}
            <circle
              cx="50"
              cy="50"
              r="45"
              fill="none"
              stroke="url(#gradient1)"
              strokeWidth="3"
              strokeDasharray="282 282"
              strokeLinecap="round"
              className="animate-spin"
              style={{
                animation: "spin 3s linear infinite",
              }}
            />

            {/* MIDDLE RING - Rotates counter-clockwise */}
            <circle
              cx="50"
              cy="50"
              r="35"
              fill="none"
              stroke="url(#gradient2)"
              strokeWidth="2.5"
              strokeDasharray="220 220"
              strokeLinecap="round"
              className="animate-spin"
              style={{
                animation: "spin-reverse 4s linear infinite",
              }}
            />

            {/* INNER RING - Rotates clockwise, slower */}
            <circle
              cx="50"
              cy="50"
              r="25"
              fill="none"
              stroke="url(#gradient3)"
              strokeWidth="2"
              strokeDasharray="157 157"
              strokeLinecap="round"
              className="animate-spin"
              style={{
                animation: "spin 5s linear infinite",
              }}
            />

            {/* GRADIENTS */}
            <defs>
              {/* INDIGO TO BLUE */}
              <linearGradient
                id="gradient1"
                x1="0%"
                y1="0%"
                x2="100%"
                y2="100%"
              >
                <stop offset="0%" stopColor="#4F46E5" />
                <stop offset="50%" stopColor="#3B82F6" />
                <stop offset="100%" stopColor="#1D4ED8" />
              </linearGradient>

              {/* BLUE TO PURPLE */}
              <linearGradient
                id="gradient2"
                x1="100%"
                y1="0%"
                x2="0%"
                y2="100%"
              >
                <stop offset="0%" stopColor="#3B82F6" />
                <stop offset="50%" stopColor="#8B5CF6" />
                <stop offset="100%" stopColor="#6366F1" />
              </linearGradient>

              {/* PURPLE TO INDIGO */}
              <linearGradient
                id="gradient3"
                x1="0%"
                y1="100%"
                x2="100%"
                y2="0%"
              >
                <stop offset="0%" stopColor="#8B5CF6" />
                <stop offset="50%" stopColor="#4F46E5" />
                <stop offset="100%" stopColor="#3B82F6" />
              </linearGradient>
            </defs>
          </svg>

          {/* CENTER DOT */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-3 h-3 sm:w-4 sm:h-4 rounded-full bg-gradient-to-br from-indigo-600 to-blue-600 shadow-lg" />
          </div>
        </div>

        {/* LOADING TEXT */}
        <div className="text-center">
          <h3 className="text-sm sm:text-base font-semibold text-gray-800 dark:text-gray-200">
            Loading
          </h3>
          <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-1">
            Please wait while we prepare your content...
          </p>
        </div>

        {/* ANIMATED DOTS */}
        <div className="flex items-center gap-1.5">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-gradient-to-r from-indigo-500 to-blue-500"
              style={{
                animation: `bounce 1.4s ease-in-out infinite`,
                animationDelay: `${i * 0.16}s`,
              }}
            />
          ))}
        </div>
      </div>

      {/* CSS ANIMATIONS */}
      <style jsx>{`
        @keyframes spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }

        @keyframes spin-reverse {
          from {
            transform: rotate(360deg);
          }
          to {
            transform: rotate(0deg);
          }
        }

        @keyframes bounce {
          0%,
          100% {
            opacity: 0.3;
            transform: scale(0.8);
          }
          50% {
            opacity: 1;
            transform: scale(1.2);
          }
        }
      `}</style>
    </div>
  );
}
