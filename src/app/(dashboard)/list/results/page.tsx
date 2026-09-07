import FormModal from "@/components/FormModal";
import Pagination from "@/components/Pagination";
import Table from "@/components/Table";
import TableSearch from "@/components/TableSearch";
import ListHeader from "@/components/ListHeader";
import { resultsData, role } from "@/lib/data";
import Image from "next/image";
import Link from "next/link";
import prisma from "@/lib/prisma";
import { ITEMS_PER_PAGE } from "@/lib/settings";
import { Prisma } from "@prisma/client";
{
  /* DATA TYPE FOR EXAM */
}
type ResultsList = {
  id: number;
  title: string;
  studentName: string;
  studentSurname: string;
  teacherName: string;
  teacherSurname: string;
  score: number;
  className: string;
  startTime: Date;
};

{
  /* TABLE HEAD ARRAY STRUCTURE */
}
const columns = [
  {
    header: "Title",
    accessor: "title",
  },

  {
    header: "Student",
    accessor: "student",
  },

  {
    header: "Score",
    accessor: "score",
    className: " hidden md:table-cell ",
  },

  {
    header: "Teacher",
    accessor: "teacher",
    className: " hidden md:table-cell ",
  },

  {
    header: "Class",
    accessor: "class",
    className: " hidden md:table-cell ",
  },

  {
    header: "Date",
    accessor: "date",
    className: " hidden md:table-cell ",
  },

  {
    header: "Actions",
    accessor: "action",
  },
];

const renderRow = (item: ResultsList) => (
  <tr
    key={item.id}
    className=" border-b border-gray-200 even:bg-slate-50 text-sm hover:bg-PatoPurple/10 transition-all duration-145"
  >
    <td className=" flex items-center gap-4 p-4">{item.title}</td>

    <td>{item.studentName + " " + item.studentSurname}</td>

    <td className=" hidden md:table-cell">{item.score}</td>

    <td className=" hidden md:table-cell">
      {item.teacherName + " " + item.teacherSurname}
    </td>

    <td className=" hidden md:table-cell">{item.className}</td>

    <td className=" hidden md:table-cell">
      {new Intl.DateTimeFormat("en-UK").format(item.startTime)}
    </td>

    <td>
      <div className="flex items-center gap-2">
        {role === "admin" && (
          <>
            <FormModal table="result" type="update" data={item} />

            <FormModal table="result" type="delete" id={item.id} />
          </>
        )}
      </div>
    </td>
  </tr>
);

const ResultListPage = async ({
  searchParams,
}: {
  searchParams: { [key: string]: string | undefined };
}) => {
  const { page, ...queryParams } = searchParams;

  const p = page ? parseInt(page) : 1;

  // URL PARAMS CONDITION

  const query: Prisma.ResultWhereInput = {};

  if (queryParams) {
    for (const [key, value] of Object.entries(queryParams)) {
      if (value !== undefined) {
        switch (key) {
          case "StudentId":
            query.studentId = value;
            break;
          case "search":
            query.OR = [
              { exam: { title: { contains: value, mode: "insensitive" } } },
              { student: { name: { contains: value, mode: "insensitive" } } },
            ];
            break;
          default:
            break;
        }
      }
    }
  }

  const [dataRes, count] = await prisma.$transaction([
    prisma.result.findMany({
      where: query,
      include: {
        student: { select: { name: true, surname: true } },
        exam: {
          include: {
            lesson: {
              select: {
                class: { select: { name: true } },
                teacher: { select: { name: true, surname: true } },
              },
            },
          },
        },
        assignment: {
          include: {
            lesson: {
              select: {
                class: { select: { name: true } },
                teacher: { select: { name: true, surname: true } },
              },
            },
          },
        },
      },
      take: ITEMS_PER_PAGE,
      skip: ITEMS_PER_PAGE * (p - 1),
    }),

    prisma.result.count({ where: query }),
  ]);

  const data = dataRes.map((item) => {
    const assesment = item.exam || item.assignment;

    if (!assesment) return null;

    const isExam = "startTime" in assesment;

    return {
      id: item.id,
      title: assesment.title,
      studentName: item.student.name,
      studentSurname: item.student.surname,
      teacherName: assesment.lesson.teacher.name,
      teacherSurname: assesment.lesson.teacher.surname,
      score: item.score,
      className: assesment.lesson.class.name,
      startTime: isExam ? assesment.startTime : assesment.startDate,
    };
  });

  return (
    /* TOP  CONTAINER*/
    <div className="bg-white bg-dark-2 p-4 rounded-md dark:rounded-3xl flex-1 mx-4 my-4 md:mx-0 md:my-0 md:p-6">
      <ListHeader
        title="All Results"
        createTable={role === "admin" ? "result" : null}
      />

      {/* LIST  LINK */}
      <Table columns={columns} renderRow={renderRow} data={data} />

      {/* PAGINATION  LINK */}
      <Pagination page={p} count={count} />
    </div>
  );
};

export default ResultListPage;
