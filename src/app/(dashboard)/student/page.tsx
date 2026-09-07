import Announcements from "@/components/Announcements";
import BigCalendar from "@/components/BigCalendar";
import EventCalendar from "@/components/EventCalendar";
import ResultSheet from "@/components/ResultSheet";

const StudentPage = () => {
  return (
    /* PAGE MAIN CONTAINER  */
    <div className=" flex-1 p-4 flex gap-4 flex-col xl:flex-row">
      {/* LEFT  CONTAINER*/}
      <div className=" w-full xl:W-2/3 ">
        <div className="bg-white bg-dark p-4 rounded-md dark:rounded-3xl h-screen ">
          <h1 className=" text-xl font-semibold">Schedule (JSS1)</h1>

          <BigCalendar />
        </div>

        {/* Result Sheet for student */}
        <div className="mt-12">
          <ResultSheet />
        </div>
      </div>

      {/* RIGHT CONTAINER */}
      <div className=" w-full xl:w-1/3 flex flex-col gap-8 ">
        <EventCalendar />
        <Announcements />
      </div>
    </div>
  );
};

export default StudentPage;
