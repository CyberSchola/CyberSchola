import FormModal from "@/components/FormModal";
import Pagination from "@/components/Pagination";
import Table from "@/components/Table";
import TableSearch from "@/components/TableSearch";
import ListHeader from "@/components/ListHeader";
import { role, subjectsData } from "@/lib/data";
import Image from "next/image";
import { Prisma, Subject, Teacher } from "@prisma/client";
import prisma from "@/lib/prisma";
import { ITEMS_PER_PAGE } from "@/lib/settings";

{
  /* DATA TYPE FOR SUBJECT */
}
type SubjectList = Subject & { teachers: Teacher[] };

{
  /* TABLE HEAD ARRAY STRUCTURE */
}
const columns = [
  {
    header: "Subject Name",
    accessor: "name",
  },
  {
    header: "Teachers",
    accessor: "teachers",
    className: " hidden md:table-cell ",
  },
  {
    header: "Actions",
    accessor: "action",
  },
];

const renderRow = (item: SubjectList) => (
  <tr
    key={item.id}
    className=" border-b border-gray-200 even:bg-slate-50 text-sm hover:bg-PatoPurple/10 transition-all duration-145"
  >
    <td className=" flex items-center gap-4 p-4">{item.name}</td>

    <td className=" hidden md:table-cell">
      {item.teachers.map((teacher) => teacher.name).join(" , ")}
    </td>

    <td>
      <div className="flex items-center gap-2">
        {role === "admin" && (
          <>
            <FormModal table="subject" type="update" data={item} />

            <FormModal table="subject" type="delete" id={item.id} />
          </>
        )}
      </div>
    </td>
  </tr>
);

const SubjectListPage = async ({
  searchParams,
}: {
  searchParams: { [key: string]: string | undefined };
}) => {
  const { page, ...queryParams } = searchParams;

  const p = page ? parseInt(page) : 1;

  // URL PARAMS CONDITION

  const query: Prisma.SubjectWhereInput = {};

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
    prisma.subject.findMany({
      where: query,
      include: {
        teachers: true,
      },
      take: ITEMS_PER_PAGE,
      skip: ITEMS_PER_PAGE * (p - 1),
    }),

    prisma.subject.count({ where: query }),
  ]);

  return (
    /* TOP  CONTAINER*/
    <div className="bg-white bg-dark p-4 rounded-md dark:rounded-3xl flex-1 mx-4 my-4 md:mx-0 md:my-0 md:p-6">
      <ListHeader
        title="All Subjects"
        createTable={role === "admin" ? "subject" : null}
      />

      {/* LIST  LINK */}
      <Table columns={columns} renderRow={renderRow} data={data} />

      {/* PAGINATION  LINK */}
      <Pagination page={p} count={count} />
    </div>
  );
};

export default SubjectListPage;
