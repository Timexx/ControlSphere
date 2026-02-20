const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const machines = await prisma.machine.findMany({ select: { id: true } });
  const machineIds = machines.map(m => m.id);
  
  console.time('queryRaw');
  const metricsRows = await prisma.$queryRaw`
    SELECT m."machineId", m."cpuUsage", m."ramUsage", m."ramTotal", m."ramUsed", m."diskUsage", m."diskTotal", m."diskUsed", m."uptime"
    FROM "Metric" m
    INNER JOIN (
      SELECT "machineId", MAX("timestamp") AS "maxTs"
      FROM "Metric"
      WHERE "machineId" IN (${machineIds.join("','")})
      GROUP BY "machineId"
    ) latest
    ON m."machineId" = latest."machineId" AND m."timestamp" = latest."maxTs"
  `;
  console.timeEnd('queryRaw');
  
  console.time('findFirst');
  const metrics = await Promise.all(machineIds.map(id => 
    prisma.metric.findFirst({
      where: { machineId: id },
      orderBy: { timestamp: 'desc' },
      select: { machineId: true, cpuUsage: true, ramUsage: true, ramTotal: true, ramUsed: true, diskUsage: true, diskTotal: true, diskUsed: true, uptime: true }
    })
  ));
  console.timeEnd('findFirst');
}
main().catch(console.error).finally(() => prisma.$disconnect());
