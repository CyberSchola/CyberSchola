"use client"
import { useRouter } from "next/navigation"
import { FaSearch } from "react-icons/fa"

const TableSearch = () => {

  const router = useRouter();

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    // Implement search functionality here
    
    e.preventDefault();
    const value = (e.currentTarget.elements[0] as HTMLInputElement).value;

    const params = new URLSearchParams(window.location.search);
    params.set("search", value);
    const newUrl = `${window.location.pathname}?${params.toString()}`;
    router.push(newUrl);

  }

  return (
    <div className=''>
        { /* SEARCH BAR AND INPUT CONTAINER*/ }
            <form onSubmit={handleSubmit} className=' w-full md:w-auto flex items-center gap-2 text-xs rounded-full ring-[1.5px] ring-gray-300 px-2 '>
              
              {/* SEARCH BAR IMAGE */}
                < FaSearch className="text-gray-500" size={16} />
      
              {/* SEARCH INPUT */}
              <input 
                type="text" 
                placeholder="Search..."
                className=" w-[200px] p-2 bg-transparent outline-none "
              />
            </form>
    </div>
  )
}

export default TableSearch