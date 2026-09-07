import FormModal from "@/components/FormModal";
import Pagination from "@/components/Pagination";
import Table from "@/components/Table";
import ListHeader from "@/components/ListHeader";
import { role, teachersData } from "@/lib/data";
import Image from "next/image";
import Link from "next/link";
import { FaEye } from "react-icons/fa";
import { Class, Prisma, Subject, Teacher } from "@prisma/client";
import prisma from "@/lib/prisma";
import { ITEMS_PER_PAGE } from "@/lib/settings";

/* 
 DATA TYPE FOR TEACHER (Prisma's `Teacher` already includes relations) 
 Extend with concrete relation types for clarity in this component
*/
type TeacherList = Teacher & { subjects: Subject[]; classes: Class[] };

/* TABLE HEAD ARRAY STRUCTURE */
const columns = [
  {
    header: "Info",
    accessor: "info",
  },
  {
    header: "Teacher ID",
    accessor: "teacherId",
    className: " hidden md:table-cell ",
  },
  {
    header: "Subjects",
    accessor: "subjects",
    className: " hidden md:table-cell ",
  },
  {
    header: "Classes",
    accessor: "classes",
    className: " hidden md:table-cell ",
  },
  {
    header: "Phone",
    accessor: "phone",
    className: " hidden lg:table-cell ",
  },
  {
    header: "Address",
    accessor: "address",
    className: " hidden lg:table-cell ",
  },
  {
    header: "Actions",
    accessor: "action",
  },
];

const renderRow = (item: TeacherList) => {
  return (
    <tr
      key={item.id}
      className=" border-b border-gray-200 even:bg-slate-50 text-sm hover:bg-PatoPurple/10 transition-all duration-145"
    >
      <td className=" flex items-center gap-4 p-4">
        <Image
          src={item.img ?? "/avatar.png"}
          alt={`${item.name} avatar`}
          width={40}
          height={40}
          className=" md:hidden xl:block w-10 h-10 rounded-full object-cover"
        />

        <div className=" flex flex-col">
          <h1 className="font-semibold">{item.name}</h1>
          <p className="text-xs text-gray-500">{item?.email}</p>
        </div>
      </td>

      <td className=" hidden md:table-cell">{item.username}</td>
      <td className=" hidden md:table-cell">
        {item.subjects?.map((subject) => subject.name).join(", ")}
      </td>
      <td className=" hidden md:table-cell">
        {item.classes?.map((classItem) => classItem.name).join(", ")}
      </td>
      <td className=" hidden lg:table-cell">{item.phone}</td>
      <td className=" hidden lg:table-cell">{item.address}</td>

      <td>
        <div className="flex items-center gap-2">
          <Link href={`/list/teachers/${item.id}`}>
            <button className=" w-7 h-7 flex items-center justify-center rounded-full hover:bg-PatoSky ">
              <FaEye width={16} height={16} />
            </button>
          </Link>

          {role === "admin" && (
            /* <button className=" w-7 h-7 flex items-center justify-center rounded-full bg-PatoPurple ">

              <Image src="/delete.png" alt="" width={16} height={16}/>

            </button>*/

            <FormModal table="teacher" type="delete" id={item.id} />
          )}
        </div>
      </td>
    </tr>
  );
};

const TeacherListPage = async ({
  searchParams,
}: {
  searchParams: { [key: string]: string | undefined };
}) => {
  const { page, ...queryParams } = searchParams;

  const p = page ? parseInt(page) : 1;

  // URL PARAMS CONDITION

  const query: Prisma.TeacherWhereInput = {};

  if (queryParams) {
    for (const [key, value] of Object.entries(queryParams)) {
      if (value !== undefined) {
        switch (key) {
          case "classId":
            query.lessons = {
              some: {
                classId: parseInt(value),
              },
            };
            break;
          case "search":
            query.name = {
              contains: value,
              mode: "insensitive",
            };
            break;
          default:
            break;
        }
      }
    }
  }

  const [data, count] = await prisma.$transaction([
    prisma.teacher.findMany({
      where: query,
      include: {
        subjects: true,
        classes: true,
      },
      take: ITEMS_PER_PAGE,
      skip: ITEMS_PER_PAGE * (p - 1),
    }),

    prisma.teacher.count({ where: query }),
  ]);

  return (
    /* MAIN TEACHER  CONTAINER*/
    <div className="bg-white bg-dark-2 p-4 rounded-md dark:rounded-3xl flex-1 mx-4 my-4 md:mx-0 md:my-0 md:p-6">
      <ListHeader
        title="All Teachers"
        createTable={role === "admin" ? "teacher" : null}
      />

      {/* LIST  LINK */}
      <Table columns={columns} renderRow={renderRow} data={data} />

      {/* PAGINATION  LINK */}
      <Pagination page={p} count={count} />
    </div>
  );
};

export default TeacherListPage;
