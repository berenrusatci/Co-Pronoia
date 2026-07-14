import 'dotenv/config';
import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import { createCanvas } from '../src/canvasService.js';

async function main() {
  const dbUrl = process.env.DATABASE_URL!;
  const { prisma, serviceFor } = await buildApp(dbUrl);

  const ayse = await prisma.user.create({
    data: { username: 'ayse', email: 'ayse@example.com', passwordHash: await hashPassword('sifre123') },
  });
  const bora = await prisma.user.create({
    data: { username: 'bora', email: 'bora@example.com', passwordHash: await hashPassword('sifre123') },
  });

  const canvas = await createCanvas(prisma, serviceFor, 'Ürün Yol Haritası', ayse.id);
  await prisma.canvasMember.create({
    data: { canvasId: canvas.id, userId: bora.id, role: 'editor' },
  });

  const service = serviceFor(canvas.id);
  const root = (await prisma.node.findFirst({ where: { canvasId: canvas.id } }))!;

  await service.commit(
    [
      { op: 'add_node', parentId: root.id, title: 'Araştırma', description: 'Kullanıcı görüşmeleri ve pazar analizi', nodeType: 'task', x: 200, y: 100 },
      { op: 'add_node', parentId: root.id, title: 'Tasarım', description: 'Arayüz taslakları', nodeType: 'task', x: 400, y: 100 },
      { op: 'add_node', parentId: root.id, title: 'Geliştirme', description: 'MVP implementasyonu', nodeType: 'feature', x: 300, y: 250 },
    ],
    { message: 'Ana görevler eklendi', authorId: ayse.id },
  );

  const nodes = await prisma.node.findMany({ where: { canvasId: canvas.id } });
  const arastirma = nodes.find((n) => n.title === 'Araştırma')!;
  const tasarim = nodes.find((n) => n.title === 'Tasarım')!;
  const gelistirme = nodes.find((n) => n.title === 'Geliştirme')!;

  await service.commit(
    [
      { op: 'add_edge', sourceId: arastirma.id, targetId: tasarim.id, kind: 'dependency', direction: 'directed' },
      { op: 'add_edge', sourceId: tasarim.id, targetId: gelistirme.id, kind: 'flow', direction: 'directed' },
    ],
    { message: 'Bağımlılıklar tanımlandı', authorId: bora.id },
  );

  console.log(`Örnek veri seti oluşturuldu: kanvas "${canvas.name}" (${canvas.id}), kullanıcılar: ayse/sifre123, bora/sifre123`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
