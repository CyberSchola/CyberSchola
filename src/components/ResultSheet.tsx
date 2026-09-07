"use client";
import React, { useState, useEffect, useRef } from "react";

const classes = ["JSS1", "JSS2", "JSS3", "SS1", "SS2", "SS3"];
const terms = ["First Term", "Second Term", "Third Term"];

// Full demo subjects (matches subjects used across the app)
const subjects = [
  "Math",
  "English",
  "Biology",
  "Physics",
  "Chemistry",
  "Music",
  "History",
  "Geography",
  "Art",
  "Literature",
];

type ResultRow = {
  subject: string;
  ca1: number;
  ca2: number;
  exam: number;
  total: number;
  grade: string;
  position: number;
};

type DemoResultsType = {
  [className: string]: {
    [term: string]: ResultRow[];
  };
};

// Programmatically generate demo results for every class and term so we have full coverage
const generateDemoResults = (): DemoResultsType => {
  const out: DemoResultsType = {};
  classes.forEach((cls, ci) => {
    out[cls] = {};
    terms.forEach((term, ti) => {
      const rows: ResultRow[] = subjects.map((subj, si) => {
        // deterministic-ish scores so different classes/terms look varied
        const base = 12 + ci * 2 + ti * 3 + (si % 5);
        const ca1 = Math.max(8, (base + si) % 30);
        const ca2 = Math.max(8, (base + si * 2) % 30);
        const exam = Math.max(20, (base * 2 + si * 3) % 40);
        const total = ca1 + ca2 + exam;
        let grade = "D";
        if (total >= 70) grade = "A";
        else if (total >= 60) grade = "B";
        else if (total >= 50) grade = "C";
        const position = (si % subjects.length) + 1;
        return {
          subject: subj,
          ca1,
          ca2,
          exam,
          total,
          grade,
          position,
        } as ResultRow;
      });
      out[cls][term] = rows;
    });
  });
  return out;
};

const demoResults: DemoResultsType = generateDemoResults();

const ResultSheet = ({ studentName = "Faith Nnodu", initialClass = "SS3" }: { studentName?: string; initialClass?: string }) => {
  const [selectedClass, setSelectedClass] = useState(initialClass);
  const [selectedTerm, setSelectedTerm] = useState("First Term");

  const results: ResultRow[] = demoResults[selectedClass]?.[selectedTerm] || [];

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [showLeft, setShowLeft] = useState(false);
  const [showRight, setShowRight] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const update = () => {
      setShowRight(el.scrollWidth > el.clientWidth && el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
      setShowLeft(el.scrollLeft > 5);
    };

    update();
    window.addEventListener("resize", update);
    el.addEventListener("scroll", update);

    return () => {
      window.removeEventListener("resize", update);
      el.removeEventListener("scroll", update);
    };
  }, [selectedClass, selectedTerm]);

  return (
    <div className="bg-white bg-dark-2 rounded-md dark:rounded-3xl p-4 md:p-6 shadow w-full">
      <h2 className="text-lg md:text-xl font-bold mb-3 md:mb-4">Academic Result Sheet</h2>

      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <span className="font-semibold">Student Name:</span>
          <span className="break-words">{studentName}</span>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <label className="font-semibold text-sm">Class:</label>
            <select
              value={selectedClass}
              onChange={e => setSelectedClass(e.target.value)}
              className="border rounded px-2 py-1 text-sm min-w-0 w-full sm:w-auto border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-50 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 transition"
            >
              {classes.map(cls => <option key={cls} value={cls}>{cls}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <label className="font-semibold text-sm">Term:</label>
            <select
              value={selectedTerm}
              onChange={e => setSelectedTerm(e.target.value)}
              className="border rounded px-2 py-1 text-sm min-w-0 w-full sm:w-auto border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-50 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 transition "
            >
              {terms.map(term => <option key={term} value={term}>{term}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="relative">
        <div ref={scrollRef} className="overflow-x-auto">
          <table className="min-w-[560px] w-full table-auto text-sm md:text-base border">
            <thead>
              <tr className="bg-gray-100">
                <th className="border px-3 py-2 text-left">Subject</th>
                <th className="border px-3 py-2">1st CA (30)</th>
                <th className="border px-3 py-2">2nd CA (30)</th>
                <th className="border px-3 py-2">Exam (40)</th>
                <th className="border px-3 py-2">Total (100)</th>
                <th className="border px-3 py-2">Grade</th>
                <th className="border px-3 py-2">Position</th>
              </tr>
            </thead>
            <tbody>
              {results.map((row, idx) => (
                <tr key={idx} className="hover:bg-gray-50">
                  <td className="border px-3 py-2 font-medium text-left">{row.subject}</td>
                  <td className="border px-3 py-2 text-center">{row.ca1}</td>
                  <td className="border px-3 py-2 text-center">{row.ca2}</td>
                  <td className="border px-3 py-2 text-center">{row.exam}</td>
                  <td className="border px-3 py-2 font-bold text-center">{row.total}</td>
                  <td className="border px-3 py-2 text-center">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${row.grade === "A" ? "bg-green-100 text-green-700" : row.grade === "B" ? "bg-blue-100 text-blue-700" : row.grade === "C" ? "bg-yellow-100 text-yellow-700" : "bg-red-100 text-red-700"}`}>{row.grade}</span>
                  </td>
                  <td className="border px-3 py-2 text-center">{row.position}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {showRight && (
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
            <div className="w-16 h-full bg-gradient-to-l from-white to-transparent" />
            <span className="ml-[-56px] pr-2 text-xs text-gray-500 hidden sm:inline-flex">Scroll →</span>
          </div>
        )}

        {showLeft && (
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2">
            <span className="pl-2 pr-4 text-xs text-gray-500 hidden sm:inline-flex">←</span>
            <div className="w-6 h-full bg-gradient-to-r from-white to-transparent" />
          </div>
        )}

        {showRight && (
          <div className="sm:hidden pointer-events-none absolute bottom-2 right-2 bg-white/90 text-xs text-gray-600 px-2 py-1 rounded shadow">
            Swipe →
          </div>
        )}
      </div>
    </div>
  );
};

export default ResultSheet;
