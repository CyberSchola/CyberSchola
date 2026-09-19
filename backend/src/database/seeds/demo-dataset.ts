/**
 * The hackathon demo dataset, as the team's demo plan specifies it.
 *
 * Raw records only. Nothing here says which subject is weakest or which pupil
 * needs help: those are conclusions the Admin Copilot has to derive from the
 * numbers, and writing them into the data would make the demo a recital.
 *
 * Two decisions the plan left open, recorded where the data is:
 * - Esther Williams is on the plan's roll of twelve but has no figures in it.
 *   She is enrolled with no attendance and no results, which is a situation
 *   real schools have, rather than given invented numbers.
 * - The attendance figures are exact percentages, which are only exact over
 *   100 school days, so the demo's Second Term runs for exactly 100 weekdays.
 */

export const DEMO_SCHOOL = {
  name: 'CyberSchola Demo College',
  slug: 'cyberschola-demo',
  session: { name: '2025/2026', startsOn: '2025-09-08', endsOn: '2026-07-24' },
  firstTerm: { name: 'First Term', startsOn: '2025-09-08', endsOn: '2025-12-12' },
  /** Monday 5 January to Friday 22 May 2026: twenty weeks, 100 weekdays. */
  demoTerm: { name: 'Second Term', startsOn: '2026-01-05', endsOn: '2026-05-22' },
  grade: { name: 'SS2', position: 11 },
  arm: 'A',
} as const;

export interface DemoSubject {
  readonly key: 'maths' | 'english' | 'physics' | 'chemistry' | 'biology';
  readonly name: string;
  readonly code: string;
  readonly teacher: { readonly firstName: string; readonly lastName: string };
}

export const DEMO_SUBJECTS: readonly DemoSubject[] = [
  {
    key: 'maths',
    name: 'Mathematics',
    code: 'MTH',
    teacher: { firstName: 'Adewale', lastName: 'Ibrahim' },
  },
  {
    key: 'english',
    name: 'English Language',
    code: 'ENG',
    teacher: { firstName: 'Grace', lastName: 'Okafor' },
  },
  {
    key: 'physics',
    name: 'Physics',
    code: 'PHY',
    teacher: { firstName: 'Chinedu', lastName: 'Eze' },
  },
  {
    key: 'chemistry',
    name: 'Chemistry',
    code: 'CHE',
    teacher: { firstName: 'Fatima', lastName: 'Bello' },
  },
  {
    key: 'biology',
    name: 'Biology',
    code: 'BIO',
    teacher: { firstName: 'Daniel', lastName: 'Williams' },
  },
];

export interface DemoStudent {
  readonly firstName: string;
  readonly lastName: string;
  /** Percentage of the demo term's 100 school days present, or null when the plan gives none. */
  readonly attendancePercent: number | null;
}

/** The plan's roll of twelve, in its order. */
export const DEMO_STUDENTS: readonly DemoStudent[] = [
  { firstName: 'Daniel', lastName: 'Okafor', attendancePercent: 95 },
  { firstName: 'Chiamaka', lastName: 'Eze', attendancePercent: 91 },
  { firstName: 'Samuel', lastName: 'Adeyemi', attendancePercent: 82 },
  { firstName: 'Favour', lastName: 'Johnson', attendancePercent: 97 },
  { firstName: 'David', lastName: 'Ibrahim', attendancePercent: 93 },
  { firstName: 'Esther', lastName: 'Williams', attendancePercent: null },
  { firstName: 'Michael', lastName: 'Obi', attendancePercent: 75 },
  { firstName: 'Ada', lastName: 'Nwosu', attendancePercent: 96 },
  { firstName: 'Joseph', lastName: 'Murktar', attendancePercent: 79 },
  { firstName: 'Blessing', lastName: 'Okafor', attendancePercent: 89 },
  { firstName: 'Emmanuel', lastName: 'Chukwu', attendancePercent: 68 },
  { firstName: 'Maryam', lastName: 'Yusuf', attendancePercent: 94 },
];

/** Every weekday of the demo term, in order. */
export function demoTermSchoolDays(): string[] {
  const days: string[] = [];
  const end = new Date(`${DEMO_SCHOOL.demoTerm.endsOn}T00:00:00Z`);

  for (
    let day = new Date(`${DEMO_SCHOOL.demoTerm.startsOn}T00:00:00Z`);
    day <= end;
    day = new Date(day.getTime() + 86_400_000)
  ) {
    const weekday = day.getUTCDay();

    if (weekday !== 0 && weekday !== 6) {
      days.push(day.toISOString().slice(0, 10));
    }
  }

  return days;
}

/**
 * Which school days a pupil was absent, spread evenly across the term.
 *
 * Deterministic, so every reseed produces the same registers, and spread rather
 * than bunched, so no week reads as an unexplained run of absence.
 */
export function absentDayIndexes(presentPercent: number, schoolDays: number): Set<number> {
  const absences = Math.round(schoolDays * (1 - presentPercent / 100));
  const indexes = new Set<number>();

  for (let k = 0; k < absences; k++) {
    indexes.add(Math.floor(((k + 0.5) * schoolDays) / absences));
  }

  return indexes;
}

/** An assessment's maximum score, per the plan: CA1 and CA2 out of 20, the exam out of 60. */
export const DEMO_ASSESSMENTS = [
  { type: 'CA1', maxScore: 20, assessedOn: '2026-02-06' },
  { type: 'CA2', maxScore: 20, assessedOn: '2026-03-20' },
  { type: 'EXAM', maxScore: 60, assessedOn: '2026-05-15' },
] as const;

type Scores = readonly [ca1: number, ca2: number, exam: number];

/**
 * Second Term scores from the plan, by pupil, in DEMO_SUBJECTS order:
 * Mathematics, English Language, Physics, Chemistry, Biology.
 *
 * Esther Williams is absent: the plan gives her no scores.
 */
export const DEMO_RESULTS: Readonly<Record<string, readonly Scores[]>> = {
  'Daniel Okafor': [[13, 14, 36], [17, 18, 52], [14, 15, 43], [15, 15, 44], [17, 16, 49]],
  'Chiamaka Eze': [[9, 11, 31], [16, 17, 48], [12, 13, 38], [13, 14, 41], [15, 16, 46]],
  'Samuel Adeyemi': [[7, 9, 27], [14, 15, 43], [10, 11, 34], [12, 13, 38], [14, 15, 43]],
  'Favour Johnson': [[15, 16, 46], [18, 18, 54], [16, 15, 46], [16, 17, 48], [17, 18, 51]],
  'David Ibrahim': [[10, 11, 30], [15, 16, 46], [13, 12, 37], [14, 14, 40], [15, 15, 44]],
  'Michael Obi': [[6, 8, 25], [13, 14, 40], [9, 10, 30], [11, 12, 36], [13, 14, 41]],
  'Ada Nwosu': [[16, 17, 49], [18, 19, 55], [15, 16, 47], [16, 16, 48], [18, 17, 52]],
  'Joseph Murktar': [[8, 10, 28], [15, 15, 44], [11, 12, 35], [12, 13, 39], [14, 15, 43]],
  'Blessing Okafor': [[11, 12, 34], [16, 17, 49], [13, 14, 41], [14, 14, 42], [16, 16, 47]],
  'Emmanuel Chukwu': [[5, 7, 23], [12, 13, 38], [8, 9, 28], [10, 11, 34], [12, 13, 39]],
  'Maryam Yusuf': [[13, 14, 39], [17, 18, 52], [12, 14, 40], [15, 15, 44], [16, 17, 48]],
};
