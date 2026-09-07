import Announcements from "@/components/Announcements"
import BigCalendar from "@/components/BigCalendar";
import EventCalendar from "@/components/EventCalendar";
import Link from "next/link"
import { FaChalkboardTeacher, FaUserGraduate } from 'react-icons/fa';

const LiveClass = () => {
  return (

    /* PAGE MAIN CONTAINER  */
    <div className=' p-4 flex gap-4 flex-col xl:flex-row'>
      
      {/* LEFT  CONTAINER*/}
      <div className=" w-full xl:W-2/3 ">

       <div className="h-full bg-white bg-dark-2 p-4 rounded-md dark:rounded-3xl ">

          <h1 className=" text-xl font-semibold "> ExtraLive Classes </h1>
          <p className=" text-sm text-gray-400 font-light my-4 "> Empowering virtual learning for everyone </p>

          <div className=" mt-14 rounded-md p-4  ">

            <h1 className=" flex items-center justify-center text-gray-700 mb-6 mt-8 font-semibold  ">
              Choose your role to join a live class
            </h1>
          

            <div className="flex flex-col sm:flex-row items-center sm:justify-evenly gap-3 mt-10 mb-9 w-full">

              <Link className="w-full sm:w-auto max-w-xs flex items-center justify-center gap-2 px-6 py-3 bg-blue-400 text-white rounded-xl shadow hover:bg-blue-700 transition text-lg font-semibold focus:ring-2 focus:ring-PatoSkyLight outline-none " href="liveclass/teacherslive">

                <FaChalkboardTeacher className="text-2xl outline-none" />
                <span>Teacher</span>

              </Link>

              <Link className="w-full sm:w-auto max-w-xs flex items-center justify-center gap-2 px-6 py-3 bg-purple-400 text-white rounded-xl shadow hover:bg-purple-700 transition text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-lightpurple" href="liveclass/studentslive">

                <FaUserGraduate className="text-2xl" />
                <span>Student</span>

              </Link>

            </div>

            <div className=" mt-20 bg-white bg-dark rounded-md p-4 md:h-[800px] h-screen ">
              <h1 className=" text-sm font-semibold text-gray-400 ">Extra Lesson&apos;s Schedule</h1>
              <BigCalendar/>
            </div>

            
          </div>


        </div>


      </div>


      {/* RIGHT CONTAINER */}
      <div className=" w-full xl:w-1/3 flex flex-col gap-8 ">
        <EventCalendar />
        <Announcements/>
      </div>

    </div>
    
  )
}

export default LiveClass