// Generate printable QR PNGs for each counter.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import QRCode from "qrcode";
import { PrismaClient } from "@prisma/client";

const BASE = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";

async function main() {
  const prisma = new PrismaClient();
  const out = path.join(process.cwd(), ".qr");
  await mkdir(out, { recursive: true });

  const counters = await prisma.counter.findMany();
  for (const c of counters) {
    const url = `${BASE}/c/${c.slug}`;
    const png = await QRCode.toBuffer(url, { width: 512, margin: 2 });
    const file = path.join(out, `${c.slug}.png`);
    await writeFile(file, png);
    console.log(`[qr] ${c.name} -> ${file} (${url})`);
  }

  // Also dump printable A4-friendly HTML
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>QR codes</title>
<style>body{font-family:sans-serif;background:#fff;color:#111}.row{display:flex;flex-wrap:wrap;gap:24px;padding:24px}
.card{border:1px solid #ddd;border-radius:12px;padding:16px;width:280px;text-align:center}
img{width:100%;height:auto}h2{margin:0 0 4px 0}p{margin:0;color:#555}</style></head>
<body><h1 style="padding:24px">Cafeteria QR codes — print and paste at counters</h1>
<div class="row">${counters.map((c) => `
<div class="card"><img src="${c.slug}.png" alt="${c.slug}"/><h2>${c.name}</h2><p>${BASE}/c/${c.slug}</p></div>`).join("")}
</div></body></html>`;
  await writeFile(path.join(out, "print.html"), html);
  console.log(`[qr] printable sheet -> ${path.join(out, "print.html")}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });