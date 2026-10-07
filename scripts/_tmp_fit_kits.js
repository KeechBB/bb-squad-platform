const {PrismaClient}=require("@prisma/client");
const fs=require("fs");
const p=new PrismaClient();
(async()=>{
  const rows=await p.$queryRawUnsafe(`
    SELECT COALESCE(NULLIF(u.nick,''), NULLIF(u."steamName",''), u.name, r."nickAtSpawn") AS nick,
           r.kit, COUNT(*)::int AS n
    FROM "SquadRoleEvent" r
    JOIN "User" u ON u.id=r."userId"
    WHERE r."spawnedAt" > NOW() - INTERVAL '120 days'
    GROUP BY 1,2
    ORDER BY 1, n DESC
  `);
  const by={};
  for (const row of rows){
    const k=String(row.nick||"").trim().toLowerCase();
    if(!k) continue;
    if(!by[k]) by[k]=[];
    by[k].push({kit:row.kit, n:row.n});
  }
  const out={updatedAt:new Date().toISOString(), source:"SquadRoleEvent 120d", byNick:by};
  fs.writeFileSync("/tmp/fit-kit-majority.json", JSON.stringify(out));
  const c={};
  for (const arr of Object.values(by)) c[arr[0].kit]=(c[arr[0].kit]||0)+1;
  console.log("nicks", Object.keys(by).length, JSON.stringify(c));
  await p.$disconnect();
})().catch(e=>{console.error(e); process.exit(1);});