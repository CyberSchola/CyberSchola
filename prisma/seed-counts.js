// Load .env so DATABASE_URL is available when running this script directly
require('dotenv').config({ path: '.env' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  try {
    const counts = await Promise.all([
      prisma.admin.count(),
      prisma.student.count(),
      prisma.teacher.count(),
      prisma.parent.count(),
      prisma.grade.count(),
      prisma.class.count(),
      prisma.subject.count(),
      prisma.lesson.count(),
      prisma.exam.count(),
    ]);
    const names = ['admins','students','teachers','parents','grades','classes','subjects','lessons','exams'];
    names.forEach((n, i) => console.log(`${n}: ${counts[i]}`));
  } catch (e) {
    console.error('Error while counting:', e);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();
