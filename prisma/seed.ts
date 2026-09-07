import { PrismaClient, Prisma } from "@prisma/client";
const prisma = new PrismaClient();

const DAYS = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
] as const;
async function main() {
  // Make seeding idempotent.
  // 1) Clear transient tables that are safe to recreate
  await prisma.attendance.deleteMany();
  await prisma.result.deleteMany();
  await prisma.assignment.deleteMany();
  await prisma.exam.deleteMany();
  await prisma.lesson.deleteMany();
  await prisma.event.deleteMany();
  await prisma.announcement.deleteMany();

  // 2) Bulk create simple lookup/parent records using createMany for speed and idempotency
  await prisma.admin.createMany({
    data: [
      { id: 'admin1', username: 'admin1' },
      { id: 'admin2', username: 'admin2' },
    ],
    skipDuplicates: true,
  });

  const gradeData = Array.from({ length: 6 }, (_, i) => ({ level: i + 1 }));
  await prisma.grade.createMany({ data: gradeData, skipDuplicates: true });

  // fetch grade ids
  const gradesAll = await prisma.grade.findMany();
  const gradeMap: Record<number, number> = {};
  for (const g of gradesAll) gradeMap[g.level] = g.id;

  const classData = Array.from({ length: 6 }, (_, i) => ({
    name: `${i + 1}A`,
    gradeId: gradeMap[i + 1],
    capacity: Math.floor(Math.random() * (20 - 15 + 1)) + 15,
  }));
  await prisma.class.createMany({ data: classData, skipDuplicates: true });

  // build class map
  const classesAll = await prisma.class.findMany();
  const classMap: Record<string, number> = {};
  for (const c of classesAll) classMap[c.name] = c.id;

  // Subjects
  const subjectDataList = [
    'Mathematics',
    'Science',
    'English',
    'History',
    'Geography',
    'Physics',
    'Chemistry',
    'Biology',
    'Computer Science',
    'Art',
  ];
  await prisma.subject.createMany({
    data: subjectDataList.map((name) => ({ name })),
    skipDuplicates: true,
  });
  const subjectsAll = await prisma.subject.findMany();
  const subjectMap: Record<string, number> = {};
  for (const s of subjectsAll) subjectMap[s.name] = s.id;

  // Teachers (bulk)
  const teacherData = Array.from({ length: 15 }, (_, i) => {
    const idx = i + 1;
    return {
      id: `teacher${idx}`,
      username: `teacher${idx}`,
      name: `TName${idx}`,
      surname: `TSurname${idx}`,
      email: `teacher${idx}@example.com`,
      phone: `123-456-789${idx}`,
      address: `Address${idx}`,
      bloodType: 'A+',
      sex: idx % 2 === 0 ? 'MALE' : 'FEMALE',
      birthday: new Date(new Date().setFullYear(new Date().getFullYear() - 30)),
    } as any;
  });
  await prisma.teacher.createMany({ data: teacherData, skipDuplicates: true });

  // Connect teacher relations (subjects/classes) in a single transaction for speed.
  const teacherRelationUpdates = [] as any[];
  for (let i = 1; i <= 15; i++) {
    const teacherId = `teacher${i}`;
    const subjectName = subjectDataList[(i - 1) % subjectDataList.length];
    const subjectId = subjectMap[subjectName];
    const classId = classMap[`${((i - 1) % 6) + 1}A`];
    const data: any = {};
    if (subjectId) data.subjects = { connect: [{ id: subjectId }] };
    if (classId) data.classes = { connect: [{ id: classId }] };
    if (Object.keys(data).length > 0) {
      teacherRelationUpdates.push(prisma.teacher.update({ where: { id: teacherId }, data }));
    }
  }
  if (teacherRelationUpdates.length > 0) {
    try {
      await prisma.$transaction(teacherRelationUpdates);
    } catch (e) {
      // Log and continue - relation connects are best-effort for seeding
      console.warn('Warning: some teacher relation connects failed', e);
    }
  }

  // Parents (bulk)
  const parentsData = Array.from({ length: 25 }, (_, i) => {
    const id = `parentId${i + 1}`;
    return {
      id,
      username: id,
      name: `PName ${i + 1}`,
      surname: `PSurname ${i + 1}`,
      email: `parent${i + 1}@example.com`,
      phone: `123-456-789${i + 1}`,
      address: `Address${i + 1}`,
    } as any;
  });
  await prisma.parent.createMany({ data: parentsData, skipDuplicates: true });

  // Students (bulk)
  const studentsData = Array.from({ length: 50 }, (_, i) => {
    const idx = i + 1;
    const parentIndex = Math.ceil(idx / 2) % 25 || 25;
    return {
      id: `student${idx}`,
      username: `student${idx}`,
      name: `SName${idx}`,
      surname: `SSurname ${idx}`,
      email: `student${idx}@example.com`,
      phone: `987-654-321${idx}`,
      address: `Address${idx}`,
      bloodType: 'O-',
      sex: idx % 2 === 0 ? 'MALE' : 'FEMALE',
      parentId: `parentId${parentIndex}`,
      gradeId: gradeMap[((idx % 6) + 1)],
      classId: classMap[`${(idx % 6) + 1}A`],
      birthday: new Date(new Date().setFullYear(new Date().getFullYear() - 10)),
    } as any;
  });
  await prisma.student.createMany({ data: studentsData, skipDuplicates: true });

  // Create transient records (lessons, exams, assignments, results, attendance, events, announcements)
  // create lessons and collect their ids so FK references remain valid
  const lessonsIds: number[] = [];
  for (let i = 1; i <= 30; i++) {
    const subjectName = subjectDataList[(i - 1) % subjectDataList.length];
    const subject = await prisma.subject.findUnique({ where: { name: subjectName } });
    const className = `${((i - 1) % 6) + 1}A`;
    const classId = classMap[className];
    const lesson = await prisma.lesson.create({
      data: {
        name: `Lesson${i}`,
        day: DAYS[Math.floor(Math.random() * DAYS.length)] as any,
        startTime: new Date(new Date().setHours(new Date().getHours() + 1)),
        endTime: new Date(new Date().setHours(new Date().getHours() + 3)),
        subjectId: subject!.id,
        classId: classId!,
        teacherId: `teacher${(i % 15) + 1}`,
      },
    });
    lessonsIds.push(lesson.id);
  }

  // Exams (bulk)
  const examsData = Array.from({ length: 10 }, (_, idx) => {
    const i = idx + 1;
    return {
      title: `Exam ${i}`,
      startTime: new Date(new Date().setHours(new Date().getHours() + 1)),
      endTime: new Date(new Date().setHours(new Date().getHours() + 2)),
      lessonId: lessonsIds[(i - 1) % lessonsIds.length],
    } as any;
  });
  await prisma.exam.createMany({ data: examsData });

  // Assignments (bulk)
  const assignmentsData = Array.from({ length: 10 }, (_, idx) => {
    const i = idx + 1;
    return {
      title: `Assignment ${i}`,
      startDate: new Date(new Date().setHours(new Date().getHours() + 1)),
      dueDate: new Date(new Date().setDate(new Date().getDate() + 1)),
      lessonId: lessonsIds[(i - 1) % lessonsIds.length],
    } as any;
  });
  await prisma.assignment.createMany({ data: assignmentsData });

  // create results referencing the created exams/assignments (bulk)
  const examsAll = await prisma.exam.findMany({ orderBy: { id: 'asc' } });
  const assignmentsAll = await prisma.assignment.findMany({ orderBy: { id: 'asc' } });
  const resultsData: any[] = [];
  for (let i = 1; i <= 10; i++) {
    if (i <= 5) {
      resultsData.push({ score: 90, studentId: `student${i}`, examId: examsAll[(i - 1) % examsAll.length].id });
    } else {
      resultsData.push({ score: 90, studentId: `student${i}`, assignmentId: assignmentsAll[(i - 6) % assignmentsAll.length].id });
    }
  }
  await prisma.result.createMany({ data: resultsData });

  // Attendance (bulk)
  const attendanceData = Array.from({ length: 10 }, (_, idx) => {
    const i = idx + 1;
    return {
      date: new Date(),
      present: true,
      studentId: `student${i}`,
      lessonId: lessonsIds[(i - 1) % lessonsIds.length],
    } as any;
  });
  await prisma.attendance.createMany({ data: attendanceData });

  // Events (bulk)
  const eventsData = Array.from({ length: 5 }, (_, idx) => {
    const i = idx + 1;
    return {
      title: `Event ${i}`,
      description: `Description for Event ${i}`,
      startTime: new Date(new Date().setHours(new Date().getHours() + 1)),
      endTime: new Date(new Date().setHours(new Date().getHours() + 2)),
      classId: classMap[`${((i - 1) % 6) + 1}A`],
    } as any;
  });
  await prisma.event.createMany({ data: eventsData });

  // Announcements (bulk)
  const announcementsData = Array.from({ length: 5 }, (_, idx) => {
    const i = idx + 1;
    return {
      title: `Announcement ${i}`,
      description: `Description for Announcement ${i}`,
      date: new Date(),
      classId: classMap[`${((i - 1) % 6) + 1}A`],
    } as any;
  });
  await prisma.announcement.createMany({ data: announcementsData });

  console.log('Seeding completed successfully.');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  }); 