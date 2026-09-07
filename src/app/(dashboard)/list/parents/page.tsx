import FormModal from "@/components/FormModal";
import Pagination from "@/components/Pagination";
import Table from "@/components/Table";
import TableSearch from "@/components/TableSearch";
import ListHeader from "@/components/ListHeader";
import { parentsData, role } from "@/lib/data";
import Image from "next/image";
import Link from "next/link";
import { Parent, Prisma, Student } from "@prisma/client";
import prisma from "@/lib/prisma";
import { ITEMS_PER_PAGE } from "@/lib/settings";

{
  /* DATA TYPE FOR PARENT */
}
type ParentList = Parent & { students: Student[] };

{
  /* TABLE HEAD ARRAY STRUCTURE */
}
const columns = [
  {
    header: "Info",
    accessor: "info",
  },
  {
    header: "Student Names",
    accessor: "students",
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

const renderRow = (item: ParentList) => (
  <tr
    key={item.id}
    className=" border-b border-gray-200 even:bg-slate-50 text-sm hover:bg-PatoPurple/10 transition-all duration-145"
  >
    <td className=" flex items-center gap-4 p-4">
      <div className=" flex flex-col">
        <h1 className="font-semibold">{item.name}</h1>
        <p className="text-xs text-gray-500">{item?.email}</p>
      </div>
    </td>

    <td className=" hidden md:table-cell">
      {item.students.map((student) => student.name).join(",")}
    </td>
    <td className=" hidden lg:table-cell">{item.phone}</td>
    <td className=" hidden lg:table-cell">{item.address}</td>

    <td>
      <div className="flex items-center gap-2">
        {role === "admin" && (
          <>
            <FormModal table="parent" type="update" data={item} />

            <FormModal table="parent" type="delete" id={item.id} />
          </>
        )}
      </div>
    </td>
  </tr>
);

const ParentListPage = async ({
  searchParams,
}: {
  searchParams: { [key: string]: string | undefined };
}) => {
  const { page, ...queryParams } = searchParams;

  const p = page ? parseInt(page) : 1;

  // URL PARAMS CONDITION

  const query: Prisma.ParentWhereInput = {};

  if (queryParams) {
    for (const [key, value] of Object.entries(queryParams)) {
      if (value !== undefined) {
        switch (key) {
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
    prisma.parent.findMany({
      where: query,
      include: {
        students: true,
      },
      take: ITEMS_PER_PAGE,
      skip: ITEMS_PER_PAGE * (p - 1),
    }),

    prisma.parent.count({ where: query }),
  ]);

  return (
    /* TOP  CONTAINER*/
    <div className="bg-white bg-dark-2 p-4 rounded-md dark:rounded-3xl flex-1 mx-4 my-4 md:mx-0 md:my-0 md:p-6">
      <ListHeader
        title="All Parents"
        createTable={role === "admin" ? "parent" : null}
      />

      {/* LIST  LINK */}
      <Table columns={columns} renderRow={renderRow} data={data} />

      {/* PAGINATION  LINK */}
      <Pagination page={p} count={count} />
    </div>
  );
};

export default ParentListPage;
