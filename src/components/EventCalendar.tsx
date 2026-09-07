"use client";
import { useState } from "react";
import Calendar from "react-calendar";
import "react-calendar/dist/Calendar.css";
import { FaEllipsisH } from "react-icons/fa";

type ValuePiece = Date | null;

type Value = ValuePiece | [ValuePiece, ValuePiece];

//TEMPORARY
const events = [
  {
    id: 1,
    title: "lorem ipsum dolor",
    time: "12:00 PM - 2:00 PM",
    description: "lorem ipsum dolor sit amet, consectetur adipiscing elit",
  },
  {
    id: 1,
    title: "lorem ipsum dolor",
    time: "12:00 PM - 2:00 PM",
    description: "lorem ipsum dolor sit amet, consectetur adipiscing elit.",
  },
  {
    id: 1,
    title: "lorem ipsum dolor",
    time: "12:00 PM - 2:00 PM",
    description: "lorem ipsum dolor sit amet, consectetur adipiscing elit.",
  },
];

const EventCalendar = () => {
  {
    /* CALENDAR USESTATE */
  }
  const [value, onChange] = useState<Value>(new Date());

  return (
    /* CALENDAR AND EVENTS MAIN CONTAINER */
    <div className=" bg-white p-4 rounded-2xl dark:rounded-3xl bg-dark-2 ">
      {/* CALENDAR */}
      <Calendar onChange={onChange} value={value} />

      {/* EVENTS HEADER CONTAINER */}
      <div className="flex justify-between items-center mt-4 mb-3">
        {/* EVENT HEADER */}
        <h1 className=" text-lg font-semibold">Events</h1>

        {/* MORE ICON */}
        <FaEllipsisH
          width={20}
          height={20}
          className="cursor-pointer text-gray-400"
        />
      </div>

      {/* EVENT MAIN CONTAINER */}
      <div className=" flex flex-col gap-4">
        {/* EVENT  MAP STRUCTURE */}
        {events.map((event) => (
          /* EVENT  CONTAINER */
          <div
            className=" p-5 rounded-md border-2 border-gray-100 border-t-4 odd:border-t-PatoSky even:border-t-PatoPurple"
            key={event.id}
          >
            {/* EVENT TILTE AND TIME CONTAINER */}
            <div className=" flex items-center justify-between">
              {/* EVENT TITLE */}
              <h1 className="font-semibold text-gray-600 dark:text-white">
                {" "}
                {event.title}{" "}
              </h1>

              {/* EVENT TIME */}
              <span className="text-gray-300 text-xs bg-white rounded-md px-1 py-1 ">
                {" "}
                {event.time}{" "}
              </span>
            </div>

            {/* EVENT DESCRIPTION */}
            <p className=" mt-2 text-gray-400 text-sm"> {event.description} </p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default EventCalendar;
