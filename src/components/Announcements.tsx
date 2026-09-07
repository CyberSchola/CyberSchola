const Announcements = () => {
  return (
    /* ANNOUNCEMNETS MAIN CONTAINER */
    <div className="bg-white p-4 rounded-2xl dark:rounded-3xl bg-dark ">
      {/* ANNOUNCEMENT HEADER CONTAINER */}
      <div className=" flex items-center justify-between">
        <h1 className="text-xl font-semibold">Announcements</h1>
        <span className="text-xs text-gray-400 cursor-pointer">View All</span>
      </div>

      {/* EVENTS MAIN DETAILS CONTAINER */}
      <div className=" flex flex-col gap-4 mt-4">
        {/* EVENTS DETAILS CONTAINER */}
        <div className="bg-PatoSkyLight rounded-md p-4">
          {/* EVENTS HEADER CONTAINER */}
          <div className=" flex items-center justify-between">
            {/* EVENTS HEADER */}
            <h2 className="font-medium"> Lorem ipsum dolor sit</h2>

            {/* EVENTS DATE CONTAINER */}
            <span className=" text-xs text-gray-400 bg-white rounded-md px-1 py-1">
              {" "}
              2025-01-01
            </span>
          </div>

          {/* EVENTS DESCRIPTION CONTAINER */}
          <p className=" text-sm text-gray-400 mt-1">
            Lorem ipsum dolor sit, amet consectetur adipisicing elit. Minus,
            sunt! Exercitationem error esse.
          </p>
        </div>

        {/* 2ND EVENT DETAILS CONTAINER */}
        <div className="lightpurple rounded-md p-4">
          <div className=" flex items-center justify-between">
            <h2 className="font-medium"> Lorem ipsum dolor sit</h2>
            <span className=" text-xs text-gray-400 bg-white rounded-md px-1 py-1">
              {" "}
              2025-01-01
            </span>
          </div>
          <p className=" text-sm text-gray-400 mt-1">
            Lorem ipsum dolor sit, amet consectetur adipisicing elit. Minus,
            sunt! Exercitationem error esse.
          </p>
        </div>

        {/* 3RD EVENTS DETAILS CONTAINER */}
        <div className="bg-PatoYellowLight rounded-md p-4">
          <div className=" flex items-center justify-between">
            <h2 className="font-medium"> Lorem ipsum dolor sit</h2>
            <span className=" text-xs text-gray-400 bg-white rounded-md px-1 py-1">
              {" "}
              2025-01-01
            </span>
          </div>
          <p className=" text-sm text-gray-400 mt-1">
            Lorem ipsum dolor sit, amet consectetur adipisicing elit. Minus,
            sunt! Exercitationem error esse.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Announcements;
