"use client"
import React from "react"
import TableSearch from "@/components/TableSearch"
import FormModal from "@/components/FormModal"
import { FaFilter, FaSortAlphaUp } from "react-icons/fa"

type Props = {
  title: string
  createTable?:
    | "teacher"
    | "student"
    | "parent"
    | "subject"
    | "class"
    | "lesson"
    | "exam"
    | "assignment"
    | "result"
    | "attendance"
    | "event"
    | "announcement"
    | null // if provided, shows the create button via FormModal
}

/**
 * ListHeader
 * A reusable responsive header used by list pages.
 * Layout behavior:
 * - Title on the left (stacks above the controls on small screens)
 * - Search input next to title on larger screens; full-width on small screens
 * - Action buttons (filter, sort, create) appear to the right on larger
 *   screens and sit on the same row as the search on small screens.
 */
const ListHeader: React.FC<Props> = ({ title, createTable = null }) => {
  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
      {/* Left: page title */}
      <div className="w-full sm:w-auto">
        <h1 className="text-lg font-semibold">{title}</h1>
      </div>

      {/* Right: search + actions */}
      <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
        <div className="w-full sm:w-auto">
          <TableSearch />
        </div>

        <div className="flex items-center gap-3 sm:ml-2">
          <button 
          className=" w-8 h-8 flex items-center justify-center rounded-full bg-PatoYellow "
          title="Filter"
          >
              < FaFilter className="text-gray-600" size={14} />

          </button>

          <button 
          className=" w-8 h-8 flex items-center justify-center rounded-full bg-PatoYellow "
          title="Sort"
          >
              < FaSortAlphaUp className="text-gray-600" size={14} />
          </button>

          {createTable && (
            <FormModal table={createTable} type="create" id={0} />
          )}
        </div>
      </div>
    </div>
  )
}

export default ListHeader
