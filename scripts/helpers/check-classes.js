const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async ()=>{
  try{
    const all = await p.class.findMany({ orderBy: { id: 'asc' } });
    console.log('Classes total:', all.length);
    const assigned = all.filter(c => c.supervisorId !== null && c.supervisorId !== undefined);
    console.log('Classes with supervisorId:', assigned.length);
    if (assigned.length > 0) console.log(JSON.stringify(assigned.slice(0,10), null, 2));
  }catch(e){
    console.error('ERROR', e.message || e);
  }finally{
    await p.$disconnect();
  }
})();
