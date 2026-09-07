"use client";
import React from "react";
import ResultSheet from "./ResultSheet";
import { parentsData, studentsData } from "@/lib/data";

// Renders, for the currently signed-in parent (temporary: use parentsData[0])
// a stacked view that for each child shows that child's timetable (by class)
// followed by the child's results.
const ParentChildrenOverview = ({ parentId }: { parentId?: number }) => {
  // Under-spec: using parentsData (demo) to lookup children names. In production
  // app I'd fetch the logged-in parent's data and children list.
  const parent =
    parentsData.find((p) => p.id === (parentId ?? parentsData[0].id)) ||
    parentsData[0];

  // I tried to map child names to student objects from studentsData; fall back to
  // the name if the code doesn't find a matching student record.
  const children = parent.students.map((childName: string) => {
    const student = studentsData.find((s) => s.name === childName);
    return student || { name: childName, class: "Unknown" };
  });

  return (
    <div className="flex flex-col gap-6">
      {children.map((child: any, idx: number) => (
        <div key={idx} className="bg-white p-4 rounded-md">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold">{child.name}</h2>
              {/*<p className="text-sm text-gray-500">Class: {child.class}</p>*/}
            </div>
          </div>

          <div>
            <ResultSheet studentName={child.name} initialClass={child.class} />
          </div>
        </div>
      ))}
    </div>
  );
};

export default ParentChildrenOverview;
