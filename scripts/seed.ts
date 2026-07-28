// Seed two demo counters, menu items, and staff accounts.
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { setStockFromDb } from "../lib/queue";
import { redis } from "../lib/redis";

const prisma = new PrismaClient();

async function main() {
  console.log("[seed] resetting…");

  // Hash staff passwords up front.
  const [cashierHash, kitchenHash, adminHash] = await Promise.all([
    bcrypt.hash("cashier123", 10),
    bcrypt.hash("kitchen123", 10),
    bcrypt.hash("admin123", 10),
  ]);

  // Wipe Postgres in dependency order.
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.menuItem.deleteMany();
  await prisma.counter.deleteMany();
  await prisma.user.deleteMany();

  // Flush Redis BEFORE we set stock so the seed values actually persist.
  await redis.flushdb();
  await prisma.user.createMany({
    data: [
      { phone: "01700000001", name: "Cashier One", role: "CASHIER", passwordHash: cashierHash },
      { phone: "01700000002", name: "Kitchen One", role: "KITCHEN", passwordHash: kitchenHash },
      { phone: "01700000099", name: "Admin", role: "ADMIN", passwordHash: adminHash },
    ],
  });

  const canteenA = await prisma.counter.create({ data: { slug: "canteen-a", name: "Canteen A (Hot meals)" } });
  const canteenB = await prisma.counter.create({ data: { slug: "canteen-b", name: "Canteen B (Snacks)" } });

  const aItems = [
    { name: "Chicken Biryani", price: 12000, stockQty: 30, description: "Spiced basmati, tender chicken" },
    { name: "Veg Biryani", price: 9000, stockQty: 20, description: "Vegetable & aromatic rice" },
    { name: "Beef Tehari", price: 14000, stockQty: 15, description: "Slow-cooked beef rice" },
    { name: "Egg Curry", price: 6000, stockQty: 25, description: "Two eggs, spicy curry" },
    { name: "Daal & Roti", price: 5000, stockQty: 40, description: "Lentils with 2 roti" },
    { name: "Salad", price: 3000, stockQty: 50, description: "Fresh mixed salad" },
    { name: "Coke 330ml", price: 2500, stockQty: 10, description: "Chilled" },
    { name: "Water 500ml", price: 1500, stockQty: 50, description: "Mineral water" },
  ];
  const bItems = [
    { name: "Chicken Sandwich", price: 7000, stockQty: 20 },
    { name: "Veg Sandwich", price: 5500, stockQty: 20 },
    { name: "French Fries", price: 5000, stockQty: 30 },
    { name: "Chicken Roll", price: 6500, stockQty: 25 },
    { name: "Veg Roll", price: 5000, stockQty: 25 },
    { name: "Cold Coffee", price: 4500, stockQty: 15 },
    { name: "Mango Lassi", price: 4000, stockQty: 15 },
    { name: "Chocolate Donut", price: 3000, stockQty: 30 },
  ];

  for (const [counter, items] of [[canteenA, aItems], [canteenB, bItems]] as const) {
    const created = await Promise.all(
      items.map((i) =>
        prisma.menuItem.create({
          data: { ...i, counterId: counter.id, lowStockThreshold: 3 },
        }),
      ),
    );
    await setStockFromDb(counter.id, created.map((c) => ({ id: c.id, stockQty: c.stockQty })));
  }

  console.log("[seed] done.");
  console.log("  Counter A slug: canteen-a");
  console.log("  Counter B slug: canteen-b");
  console.log("  Cashier login: 01700000001 / cashier123");
  console.log("  Kitchen login: 01700000002 / kitchen123");
  console.log("  Admin login:   01700000099 / admin123");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());