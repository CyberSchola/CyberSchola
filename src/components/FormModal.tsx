"use client";

import dynamic from "next/dynamic";
import React, { useState, useEffect, useRef } from "react";
import ReactDOM from "react-dom";
import { FaEdit, FaPlus, FaTimes, FaTrash } from "react-icons/fa";

/* NEXT OPTIMIZATION*/
const TeacherForm = dynamic(() => import("./forms/TeacherForm"), {
  loading: () => <h1>Loading....</h1>,
});
const StudentForm = dynamic(() => import("./forms/StudentForm"), {
  loading: () => <h1>Loading....</h1>,
});
const ParentForm = dynamic(() => import("./forms/ParentForm"), {
  loading: () => <h1>Loading....</h1>,
});
const SubjectForm = dynamic(() => import("./forms/SubjectForm"), {
  loading: () => <h1>Loading....</h1>,
});
const ClassForm = dynamic(() => import("./forms/ClassForm"), {
  loading: () => <h1>Loading....</h1>,
});
const LessonForm = dynamic(() => import("./forms/LessonForm"), {
  loading: () => <h1>Loading....</h1>,
});
const ExamForm = dynamic(() => import("./forms/ExamForm"), {
  loading: () => <h1>Loading....</h1>,
});
const AssignmentForm = dynamic(() => import("./forms/AssignmentForm"), {
  loading: () => <h1>Loading....</h1>,
});
const ResultForm = dynamic(() => import("./forms/ResultForm"), {
  loading: () => <h1>Loading....</h1>,
});
const EventForm = dynamic(() => import("./forms/EventForm"), {
  loading: () => <h1>Loading....</h1>,
});
const AnnouncementForm = dynamic(() => import("./forms/AnnouncementForm"), {
  loading: () => <h1>Loading....</h1>,
});

/* FORMS FOR EACH TABLE */
const forms: {
  [key: string]: (type: "create" | "update", data?: any) => JSX.Element;
} = {
  teacher: (type, data) => <TeacherForm type={type} data={data} />,
  student: (type, data) => <StudentForm type={type} data={data} />,
  parent: (type, data) => <ParentForm type={type} data={data} />,
  subject: (type, data) => <SubjectForm type={type} data={data} />,
  class: (type, data) => <ClassForm type={type} data={data} />,
  lesson: (type, data) => <LessonForm type={type} data={data} />,
  exam: (type, data) => <ExamForm type={type} data={data} />,
  assignment: (type, data) => <AssignmentForm type={type} data={data} />,
  result: (type, data) => <ResultForm type={type} data={data} />,
  event: (type, data) => <EventForm type={type} data={data} />,
  announcement: (type, data) => <AnnouncementForm type={type} data={data} />,
};

/* FORMS MODAL STRUCTURE AND CONTENT */
const FormModal = ({
  table,
  type,
  data,
  id,
}: {
  table:
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
    | "announcement";

  type: "create" | "update" | "delete";

  data?: any;

  id?: number | string;
}) => {
  const size = type === "create" ? "w-8 h-8" : "w-7 h-7";

  const bgcolor =
    type === "create"
      ? "bg-PatoYellow"
      : type === "update"
      ? "hover:bg-PatoSky"
      : "hover:bg-red-500";

  const [open, setOpen] = useState(false);
  const portalRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // create portal root when component mounts (client only)
    const el = document.createElement("div");
    el.setAttribute("data-form-modal-root", "");
    portalRef.current = el;
    document.body.appendChild(el);
    return () => {
      if (portalRef.current && portalRef.current.parentNode) {
        portalRef.current.parentNode.removeChild(portalRef.current);
      }
      portalRef.current = null;
    };
  }, []);

  const Form = () => {
    return type === "delete" && id ? (
      <form action="" className=" p-4 flex flex-col gap-4">
        <span className=" text-center font-medium">
          All data will be lost. Are you sure you want to delete this {table}?{" "}
        </span>

        <button className=" bg-red-700 text-white py-2 px-4 rounded-md border-none w-max self-center">
          Delete
        </button>
      </form>
    ) : type === "create" || type === "update" ? (
      forms[table](type, data)
    ) : (
      "Form not found!"
    );
  };

  return (
    <>
      <button
        className={` ${size} flex items-center justify-center rounded-full ${bgcolor} `}
        onClick={() => setOpen(true)}
      >
        {type === "create" ? (
          <FaPlus size={16} title="create" />
        ) : type === "update" ? (
          <FaEdit size={16} title="update" />
        ) : (
          <FaTrash size={16} title="delete" />
        )}
      </button>

      {open &&
        portalRef.current &&
        ReactDOM.createPortal(
          <div
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black bg-opacity-60"
          >
            <div className="relative w-[95%] sm:w-[90%] md:w-[70%] lg:w-[60%] xl:w-[50%] 2xl:w-[40%] bg-white bg-dark-2 p-7 rounded-2xl dark:rounded-3xl max-h-[90vh] overflow-auto">
              <Form />

              <button
                aria-label="Close modal"
                className="absolute top-4 right-4 "
                onClick={() => setOpen(false)}
              >
                <FaTimes size={18} title="close" />
              </button>
            </div>
          </div>,
          portalRef.current
        )}
    </>
  );
};

export default FormModal;
