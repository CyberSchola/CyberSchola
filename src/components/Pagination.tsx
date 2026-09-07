"use client";
import { ITEMS_PER_PAGE } from "@/lib/settings";
import { useRouter } from "next/navigation";

const Pagination = ({ page, count }: { page: number; count: number }) => {
  
  const router = useRouter();

  const hasPrev = ITEMS_PER_PAGE * (page - 1) > 0;
  const hasNext = ITEMS_PER_PAGE * (page - 1) + ITEMS_PER_PAGE < count;

  const handlePageChange = (newPage: number) => {

    // Update the URL with the new page number
    const params = new URLSearchParams(window.location.search);
    params.set("page", newPage.toString());
    const newUrl = `${window.location.pathname}?${params.toString()}`;
    router.push(newUrl);
  };
  
  return (
    <div className=" p-4 flex items-center justify-between text-gray-500 move">
      {/* BUTTON 1 */}
      <button
        disabled={!hasPrev}
        className=" py-2 px-4 rounded-md bg-slate-200 text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed try "
        onClick={() => handlePageChange(page - 1)}
      >
        Prev
      </button>

      {/* PAGE NUMBER CONTAINER */}
      <div className=" flex items-center gap-2 text-sm try padding ">
        {Array.from(
          { length: Math.ceil(count / ITEMS_PER_PAGE) },
          (_, index) => {
            const pageIndex = index + 1;
            return (
              <button key={pageIndex} className={ `px-2 rounded-sm ${ pageIndex === page ? 'bg-PatoSky' : 'bg-slate-200' }` }
                onClick={() => handlePageChange(pageIndex)}
              >
                {pageIndex}
              </button>
            );
          }
        )}
      </div>

      {/* BUTTON 3 */}
      <button className=" py-2 px-4 rounded-md bg-slate-200 text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed try"
      disabled={!hasNext}
      onClick={() => handlePageChange(page + 1)}
      >
        Next
      </button>
    </div>
  );
};

export default Pagination;
