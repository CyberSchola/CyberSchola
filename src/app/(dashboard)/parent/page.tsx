import Announcements from "@/components/Announcements";
import BigCalendar from "@/components/BigCalendar";
import EventCalendar from "@/components/EventCalendar";
import ParentChildrenOverview from "@/components/ParentChildrenOverview";

const ParentPage = () => {
  return (
    /* PAGE MAIN CONTAINER  */
    <div className=" flex-1 p-4 flex gap-4 flex-col xl:flex-row ">
      {/* LEFT  CONTAINER*/}
      <div className=" w-full xl:W-2/3 ">
        <div className="h-screen bg-white bg-dark p-4 rounded-md dark:rounded-3xl ">
          <h1 className=" text-xl font-semibold">Schedule (Joe Doe)</h1>

          <BigCalendar />
        </div>

        {/* Children overview: for each child show results */}
        <div className="mt-12 ">
          <ParentChildrenOverview />
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

export default ParentPage;
