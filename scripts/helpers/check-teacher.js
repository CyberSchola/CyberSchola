const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  try {
    const t = await p.teacher.findFirst({ include: { subjects: true, classes: true, lessons: { include: { class: true } } } });
    if (!t) {
      console.log('No teacher found in DB');
    } else {
      // mask email
      if (t.email) t.email = '***masked***';
      console.log('Teacher fetched:');
      console.log(JSON.stringify(t, null, 2));
      console.log('\nSubjects length:', (t.subjects || []).length);
      console.log('Supervisor Classes length:', (t.classes || []).length);
      console.log('Lessons length:', (t.lessons || []).length);
      const taught = (t.lessons || []).map(l => l.class?.name).filter(Boolean);
      console.log('Taught classes (unique):', Array.from(new Set(taught)));
    }
  } catch (err) {
    console.error('ERROR', err.message || err);
  } finally {
    await p.$disconnect();
  }
})();
