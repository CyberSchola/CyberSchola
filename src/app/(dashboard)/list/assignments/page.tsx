import FormModal from "@/components/FormModal";
import Pagination from "@/components/Pagination";
import Table from "@/components/Table";
import TableSearch from "@/components/TableSearch";
import ListHeader from "@/components/ListHeader";
import { assignmentsData, examsData, role } from "@/lib/data";
import Image from "next/image";
import Link from "next/link";
import { Assignment, Class, Prisma, Subject, Teacher } from "@prisma/client";
import prisma from "@/lib/prisma";
import { ITEMS_PER_PAGE } from "@/lib/settings";

{
  /* DATA TYPE FOR EXAM */
}
type AssignmentList = Assignment & {
  lesson: {
    subject: Subject;
    class: Class;
    teacher: Teacher;
  };
};

{
  /* TABLE HEAD ARRAY STRUCTURE */
}
const columns = [
  {
    header: "Subject Name",
    accessor: "name",
  },

  {
    header: "Class",
    accessor: "class",
  },

  {
    header: "Teacher",
    accessor: "teacher",
    className: " hidden md:table-cell ",
  },

  {
    header: "Due Date",
    accessor: "dueDate",
    className: " hidden md:table-cell ",
  },

  {
    header: "Actions",
    accessor: "action",
  },
];

const renderRow = (item: AssignmentList) => (
  <tr
    key={item.id}
    className=" border-b border-gray-200 even:bg-slate-50 text-sm hover:bg-PatoPurple/10 transition-all duration-145"
  >
    <td className=" flex items-center gap-4 p-4">{item.lesson.subject.name}</td>

    <td>{item.lesson.class.name}</td>

    <td className=" hidden md:table-cell">
      {item.lesson.teacher.name + " " + item.lesson.teacher.surname}
    </td>

    <td className=" hidden md:table-cell">
      {new Intl.DateTimeFormat("en-UK").format(item.dueDate)}
    </td>

    <td>
      <div className="flex items-center gap-2">
        {role === "admin" && (
          <>
            <FormModal table="assignment" type="update" data={item} />
            <FormModal table="assignment" type="delete" id={item.id} />
          </>
        )}
      </div>
    </td>
  </tr>
);

const AssignmentListPage = async ({
  searchParams,
}: {
  searchParams: { [key: string]: string | undefined };
}) => {
  const { page, ...queryParams } = searchParams;

  const p = page ? parseInt(page) : 1;

  // URL PARAMS CONDITION

  const query: Prisma.AssignmentWhereInput = {};

  if (queryParams) {
    for (const [key, value] of Object.entries(queryParams)) {
      if (value !== undefined) {
        switch (key) {
          case "classId":
            query.lesson = { classId: parseInt(value) };
            break;
          case "teacherId":
            query.lesson = { teacherId: value };
            break;
          case "search":
            query.lesson = {
              subject: { name: { contains: value, mode: "insensitive" } },
              teacher: { name: { contains: value, mode: "insensitive" } },
            };
            break;
          default:
            break;
        }
      }
    }
  }

  const [data, count] = await prisma.$transaction([
    prisma.assignment.findMany({
      where: query,
      include: {
        lesson: {
          select: {
            subject: { select: { name: true } },
            teacher: { select: { name: true, surname: true } },
            class: { select: { name: true } },
          },
        },
      },
      take: ITEMS_PER_PAGE,
      skip: ITEMS_PER_PAGE * (p - 1),
    }),

    prisma.assignment.count({ where: query }),
  ]);

  return (
    /* TOP  CONTAINER*/
    <div className="bg-white bg-dark p-4 rounded-md dark:rounded-3xl flex-1 mx-4 my-4 md:mx-0 md:my-0 md:p-6">
      <ListHeader
        title="All Assignments"
        createTable={role === "admin" ? "assignment" : null}
      />

      {/* LIST  LINK */}
      <Table columns={columns} renderRow={renderRow} data={data} />

      {/* PAGINATION  LINK */}
      <Pagination page={p} count={count} />
    </div>
  );
};

export default AssignmentListPage;
