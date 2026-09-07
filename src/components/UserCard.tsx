import { FaEllipsisH } from "react-icons/fa";

const UserCard = ( {type}:{type:string} ) => {
  return (
     /* USER CARDS MAIN CONTAINER */ 
    <div className=' rounded-2xl odd:bg-PatoPurple even:bg-PatoYellow p-4 flex-1'>
      
      { /* USER CARD TOP CONTENT */ }
      <div className=" flex justify-between items-center">
        { /* CONTENT DATE */ }
        <span className=" text-[10px] bg-white px-2 py-1 rounded-full text-green-600">
          2025/26
        </span>
        
        { /* MORE IMAGE ICON */ }
       < FaEllipsisH width={20} height={20} className="cursor-pointer text-white hover:text-gray-500 " />

      </div>
      
      { /* USER CARD TEXTS */ }
      <h1 className=" text-2xl font-semibold my-4">4,321</h1>
      <h2 className=" capitalize text-sm font-medium text-gray-500">{type}s</h2>
    </div>
  );
};

export default UserCard;