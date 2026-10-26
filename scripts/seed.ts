// Demo seed for Smart Queue Cafeteria.
// - Wipes Postgres + Redis and recreates counters, menu items, staff users.
// - Creates a wide menu (12 items per counter) with real food photos,
//   descriptions, varied stock, and a couple of sold-out / low-stock items
//   so the UI has meaningful state to render.
// - When DEMO_ORDERS=1 (default), also creates ~12 orders spread across
//   every OrderStatus so the cashier + kitchen dashboards have content.
//
// Re-runnable. After seed, run `npm run dev` and open:
//   http://localhost:3001/c/canteen-a
//   http://localhost:3001/cashier
//   http://localhost:3001/kitchen
import bcrypt from "bcryptjs";
import { OrderStatus, PaymentStatus, PrismaClient } from "@prisma/client";
import { setStockFromDb } from "../lib/queue";
import { k, redis } from "../lib/redis";

const prisma = new PrismaClient();
const WITH_DEMO_ORDERS = process.env.DEMO_ORDERS !== "0";

// MD5 hex digest of a UTF-8 string, computed by PostgreSQL so the result
// is byte-identical to the provider migration's `md5(c.slug)` expression.
async function md5(s: string): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<Array<{ digest: string }>>(
    `SELECT md5($1) AS digest`,
    s,
  );
  return rows[0]!.digest;
}

// Royalty-free, hot-linkable Unsplash food photography (free to use commercially).
const IMG = {
  biryani:
    "https://images.unsplash.com/photo-1631452180519-c014fe946bc7?auto=format&fit=crop&w=800&q=70",
  tehari:
    "https://images.unsplash.com/photo-1585937421612-70a008356fbe?auto=format&fit=crop&w=800&q=70",
  khichuri:
    "https://images.unsplash.com/photo-1546833999-b9f581a1996d?auto=format&fit=crop&w=800&q=70",
  eggCurry:
    "https://images.unsplash.com/photo-1626776877014-dba9c0b2c97b?auto=format&fit=crop&w=800&q=70",
  daal:
    "https://images.unsplash.com/photo-1546833999-b9f581a1996d?auto=format&fit=crop&w=800&q=70",
  salad:
    "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=800&q=70",
  roti:
    "https://images.unsplash.com/photo-1565557623262-b51c2513a641?auto=format&fit=crop&w=800&q=70",
  coke:
    "https://images.unsplash.com/photo-1622483767028-3f66f32aef97?auto=format&fit=crop&w=800&q=70",
  water:
    "https://images.unsplash.com/photo-1564419320461-6870880221ad?auto=format&fit=crop&w=800&q=70",
  lassi:
    "https://images.unsplash.com/photo-1626202378850-f1ad2a9e7c52?auto=format&fit=crop&w=800&q=70",
  coffee:
    "https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&w=800&q=70",
  tea:
    "https://images.unsplash.com/photo-1571934811356-5cc061b6821f?auto=format&fit=crop&w=800&q=70",
  sandwich:
    "https://images.unsplash.com/photo-1528735602780-2552fd46c7af?auto=format&fit=crop&w=800&q=70",
  roll:
    "https://images.unsplash.com/photo-1606755962773-d324e0a13086?auto=format&fit=crop&w=800&q=70",
  fries:
    "https://images.unsplash.com/photo-1573080496219-bb080dd4f877?auto=format&fit=crop&w=800&q=70",
  donut:
    "https://images.unsplash.com/photo-1551024601-bec78aea704b?auto=format&fit=crop&w=800&q=70",
  burger:
    "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=800&q=70",
  pizza:
    "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?auto=format&fit=crop&w=800&q=70",
  pasta:
    "https://images.unsplash.com/photo-1551183053-bf91a1d81141?auto=format&fit=crop&w=800&q=70",
  juice:
    "https://images.unsplash.com/photo-1600271886742-f049cd451bba?auto=format&fit=crop&w=800&q=70",
  // fallbacks
  plate:
    "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=800&q=70",
};

interface SeedItem {
  name: string;
  description: string;
  price: number; // in cents/poisha
  stockQty: number;
  imageUrl: string;
}

const A_ITEMS: SeedItem[] = [
  {
    name: "Chicken Biryani",
    description: "Long-grain basmati layered with tender chicken, saffron and slow-cooked spices.",
    price: 12000, stockQty: 28, imageUrl: IMG.biryani,
  },
  {
    name: "Beef Tehari",
    description: "Aromatic beef rice cooked in mustard oil with potatoes and whole garam masala.",
    price: 14000, stockQty: 14, imageUrl: IMG.tehari,
  },
  {
    name: "Veg Biryani",
    description: "Hand-pressed biryani with seasonal vegetables, mint and fried onions.",
    price: 9000, stockQty: 18, imageUrl: IMG.biryani,
  },
  {
    name: "Khichuri & Egg",
    description: "Comforting rice and lentil khichuri served with a soft-boiled egg and a green chili.",
    price: 7000, stockQty: 22, imageUrl: IMG.khichuri,
  },
  {
    name: "Egg Curry (2 pcs)",
    description: "Two farm-fresh eggs in a tangy tomato-onion curry, served with two roti.",
    price: 6000, stockQty: 30, imageUrl: IMG.eggCurry,
  },
  {
    name: "Daal Makhani",
    description: "Slow-simmered black lentils finished with butter, cream and a hint of fenugreek.",
    price: 5500, stockQty: 35, imageUrl: IMG.daal,
  },
  {
    name: "Tandoori Roti (4 pcs)",
    description: "Four clay-oven rotis with charred edges. Pairs with any curry on the menu.",
    price: 2000, stockQty: 60, imageUrl: IMG.roti,
  },
  {
    name: "Mixed Salad",
    description: "Cucumber, tomato, onion, lemon and chaat masala. Fresh-cut this morning.",
    price: 3000, stockQty: 2, imageUrl: IMG.salad, // intentionally low → "Only N left" badge
  },
  {
    name: "Coke 330ml",
    description: "Ice-cold canned Coca-Cola served with a slice of lime.",
    price: 2500, stockQty: 0, imageUrl: IMG.coke, // intentionally sold out
  },
  {
    name: "Mineral Water 500ml",
    description: "Sealed 500ml bottle of mineral water.",
    price: 1500, stockQty: 48, imageUrl: IMG.water,
  },
  {
    name: "Sweet Lassi",
    description: "Thick churned yogurt blended with sugar, cardamom and a touch of rose water.",
    price: 4000, stockQty: 16, imageUrl: IMG.lassi,
  },
  {
    name: "Masala Chai",
    description: "Strong milk tea boiled with ginger, cardamom and a hint of cinnamon.",
    price: 1500, stockQty: 70, imageUrl: IMG.tea,
  },
];

const B_ITEMS: SeedItem[] = [
  {
    name: "Chicken Sandwich",
    description: "Toasted brown bread with shredded chicken, lettuce, tomato and garlic mayo.",
    price: 7000, stockQty: 18, imageUrl: IMG.sandwich,
  },
  {
    name: "Veg Club Sandwich",
    description: "Triple-decker with cucumber, cheese, onion, green chutney and crisps.",
    price: 5500, stockQty: 16, imageUrl: IMG.sandwich,
  },
  {
    name: "Chicken Cheese Burger",
    description: "Grilled chicken patty, melted cheddar, pickles and house burger sauce.",
    price: 8500, stockQty: 14, imageUrl: IMG.burger,
  },
  {
    name: "French Fries",
    description: "Hand-cut potato fries fried golden, tossed with sea salt and herbs.",
    price: 5000, stockQty: 28, imageUrl: IMG.fries,
  },
  {
    name: "Chicken Roll",
    description: "Soft paratha rolled with spiced chicken, onions and green chutney.",
    price: 6500, stockQty: 22, imageUrl: IMG.roll,
  },
  {
    name: "Veg Roll",
    description: "Crispy golden roll stuffed with mixed vegetables, mint chutney and tamarind.",
    price: 5000, stockQty: 20, imageUrl: IMG.roll,
  },
  {
    name: "Margherita Pizza Slice",
    description: "Wood-fired pizza base, San Marzano tomato, fresh mozzarella and basil.",
    price: 6000, stockQty: 12, imageUrl: IMG.pizza,
  },
  {
    name: "Creamy Alfredo Pasta",
    description: "Penne tossed in a creamy parmesan sauce with cracked black pepper.",
    price: 9000, stockQty: 10, imageUrl: IMG.pasta,
  },
  {
    name: "Chocolate Glazed Donut",
    description: "Soft ring donut with a thick chocolate glaze. Fresh-baked this morning.",
    price: 3000, stockQty: 30, imageUrl: IMG.donut,
  },
  {
    name: "Cold Coffee",
    description: "Blended iced coffee with milk, vanilla and a crown of whipped cream.",
    price: 4500, stockQty: 14, imageUrl: IMG.coffee,
  },
  {
    name: "Mango Lassi",
    description: "Sweet Alphonso mango pulp blended with thick yogurt and ice.",
    price: 4000, stockQty: 1, imageUrl: IMG.lassi, // intentionally low
  },
  {
    name: "Fresh Orange Juice",
    description: "Squeezed-to-order juice with a touch of black salt. No added sugar.",
    price: 5000, stockQty: 0, imageUrl: IMG.juice, // intentionally sold out
  },
];

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

  // Staff users. We use `create` instead of `createMany` so we can capture
  // the IDs for the staff→counter binding rows.
  const cashierUser = await prisma.user.create({
    data: { phone: "01700000001", name: "Cashier One", role: "CASHIER", passwordHash: cashierHash },
  });
  const cashierBUser = await prisma.user.create({
    data: { phone: "01700000003", name: "Cashier Two", role: "CASHIER", passwordHash: cashierHash },
  });
  const kitchenUser = await prisma.user.create({
    data: { phone: "01700000002", name: "Kitchen One", role: "KITCHEN", passwordHash: kitchenHash },
  });
  const kitchenAUser = await prisma.user.create({
    data: { phone: "01700000004", name: "Kitchen Two", role: "KITCHEN", passwordHash: kitchenHash },
  });
  const adminUser = await prisma.user.create({
    data: { phone: "01700000099", name: "Admin", role: "ADMIN", passwordHash: adminHash },
  });
  // Demo student account so the cashier/kitchen can see a name.
  await prisma.user.create({
    data: { phone: "01712345678", name: "Demo Student", role: "STUDENT" },
  });

  // Each counter now belongs to exactly one provider. Match the deterministic
  // IDs used by the 20261013000000 migration so a re-run stays idempotent
  // (prov_<md5(slug)>) and so the seed data is consistent with what the
  // migration would have inserted.
  const providerA = await prisma.provider.upsert({
    where: { id: "prov_" + await md5("canteen-a") },
    update: {},
    create: {
      id: "prov_" + await md5("canteen-a"),
      slug: "prov-canteen-a",
      name: "Canteen A (Hot meals)",
    },
  });
  const providerB = await prisma.provider.upsert({
    where: { id: "prov_" + await md5("canteen-b") },
    update: {},
    create: {
      id: "prov_" + await md5("canteen-b"),
      slug: "prov-canteen-b",
      name: "Canteen B (Snacks & drinks)",
    },
  });
  const canteenA = await prisma.counter.create({
    data: {
      slug: "canteen-a",
      name: "Canteen A (Hot meals)",
      provider: { connect: { id: providerA.id } },
    },
  });
  const canteenB = await prisma.counter.create({
    data: {
      slug: "canteen-b",
      name: "Canteen B (Snacks & drinks)",
      provider: { connect: { id: providerB.id } },
    },
  });

  // Bind staff to counters. ADMIN is treated as "all counters" by the login
  // route, so it has no rows. The demo cashier works canteen A; a second
  // cashier and a second kitchen user cover canteen B. They have no
  // cross-counter access.
  await prisma.staffCounter.createMany({
    data: [
      { userId: cashierUser.id, counterId: canteenA.id },
      { userId: cashierBUser.id, counterId: canteenB.id },
      { userId: kitchenUser.id, counterId: canteenB.id },
      { userId: kitchenAUser.id, counterId: canteenA.id },
    ],
  });

  async function createMenu(counter: { id: string }, items: SeedItem[]) {
    const created = await Promise.all(
      items.map((i) =>
        prisma.menuItem.create({
          data: {
            counterId: counter.id,
            name: i.name,
            description: i.description,
            price: i.price,
            stockQty: i.stockQty,
            lowStockThreshold: 3,
            imageUrl: i.imageUrl,
            isAvailable: i.stockQty > 0, // auto-mark sold out at 0
          },
        })
      )
    );
    await setStockFromDb(
      counter.id,
      created.map((c) => ({ menuItemId: c.id, stockQty: c.stockQty }))
    );
    return created;
  }

  const aCreated = await createMenu(canteenA, A_ITEMS);
  const bCreated = await createMenu(canteenB, B_ITEMS);

  console.log(`[seed] canteen-a: ${aCreated.length} items, canteen-b: ${bCreated.length} items`);

  if (WITH_DEMO_ORDERS) {
    await seedDemoOrders(canteenA, aCreated, "A");
    await seedDemoOrders(canteenB, bCreated, "B");
  }

  console.log("[seed] done.");
  console.log("  Counter A slug: canteen-a");
  console.log("  Counter B slug: canteen-b");
  console.log("  Cashier login: 01700000001 / cashier123");
  console.log("  Kitchen login: 01700000002 / kitchen123");
  console.log("  Admin login:   01700000099 / admin123");
  if (WITH_DEMO_ORDERS) {
    console.log("  Demo orders created across every status.");
    console.log("  Open http://localhost:3001/cashier and /kitchen to see them.");
  }
}

interface CreatedItem {
  id: string;
  name: string;
  price: number;
  stockQty: number;
}

/**
 * Build a realistic spread of orders for a counter:
 *   - 2 PENDING_CASHIER  (just placed, waiting for the cashier)
 *   - 1 APPROVED         (cashier just approved, kitchen hasn't started)
 *   - 2 PREPARING        (kitchen is working on these)
 *   - 1 READY            (waiting at the counter for the student)
 *   - 1 COMPLETED        (delivered earlier today)
 *   - 1 REJECTED         (a recent rejection with a reason)
 *   - 1 CANCELLED        (an old cancellation)
 *
 * Timestamps are spaced realistically: pending orders are 30s-2m old,
 * preparing orders 3-8m old, ready 10m, completed ~30m, etc.
 */
async function seedDemoOrders(
  counter: { id: string },
  items: CreatedItem[],
  letter: "A" | "B"
) {
  // Pre-pick items so we don't reach for sold-out ones.
  const available = items.filter((i) => i.stockQty > 0);
  if (available.length === 0) return;

  const pickItem = (pred?: (i: CreatedItem) => boolean) => {
    const pool = pred ? available.filter(pred) : available;
    return pool[Math.floor(Math.random() * pool.length)] ?? available[0];
  };

  type Spec = {
    status: OrderStatus;
    minutesAgo: number;
    items: { menuItemId: string; qty: number }[];
    payment?: PaymentStatus;
    rejectReason?: string;
    guestPhone?: string;
  };

  // Keep things deterministic-looking: hand-pick items by name.
  const byName = (n: string) => {
    const it = items.find((i) => i.name === n);
    if (!it) throw new Error(`[seed] item not found: ${n}`);
    return it;
  };

  const specs: Spec[] = [
    // Pending cashier
    {
      status: "PENDING_CASHIER", minutesAgo: 0.5,
      items: [{ menuItemId: byName(letter === "A" ? "Chicken Biryani" : "Chicken Sandwich").id, qty: 1 }],
      guestPhone: "01712345678",
    },
    {
      status: "PENDING_CASHIER", minutesAgo: 1.5,
      items: [
        { menuItemId: byName(letter === "A" ? "Masala Chai" : "Cold Coffee").id, qty: 2 },
        { menuItemId: byName(letter === "A" ? "Mineral Water 500ml" : "Chocolate Glazed Donut").id, qty: 1 },
      ],
    },

    // Approved, kitchen not started
    {
      status: "APPROVED", minutesAgo: 2,
      items: [
        { menuItemId: byName(letter === "A" ? "Beef Tehari" : "Margherita Pizza Slice").id, qty: 1 },
        { menuItemId: byName(letter === "A" ? "Sweet Lassi" : "Cold Coffee").id, qty: 1 },
      ],
    },

    // Preparing
    {
      status: "PREPARING", minutesAgo: 3,
      items: [
        { menuItemId: byName(letter === "A" ? "Khichuri & Egg" : "Chicken Cheese Burger").id, qty: 1 },
        { menuItemId: byName(letter === "A" ? "Egg Curry (2 pcs)" : "French Fries").id, qty: 1 },
      ],
    },
    {
      status: "PREPARING", minutesAgo: 6, // older — should turn amber in the kitchen column
      items: [
        { menuItemId: byName(letter === "A" ? "Veg Biryani" : "Creamy Alfredo Pasta").id, qty: 2 },
      ],
    },

    // Ready for pickup
    {
      status: "READY", minutesAgo: 10,
      items: [
        { menuItemId: byName(letter === "A" ? "Chicken Biryani" : "Chicken Roll").id, qty: 1 },
        { menuItemId: byName(letter === "A" ? "Tandoori Roti (4 pcs)" : "Veg Roll").id, qty: 1 },
      ],
    },

    // Completed (paid)
    {
      status: "COMPLETED", minutesAgo: 35,
      payment: "PAID",
      items: [
        { menuItemId: byName(letter === "A" ? "Daal Makhani" : "Veg Club Sandwich").id, qty: 1 },
        { menuItemId: byName(letter === "A" ? "Tandoori Roti (4 pcs)" : "French Fries").id, qty: 2 },
      ],
    },

    // Rejected (a rare case so the cashier & student tracking screens can show it)
    {
      status: "REJECTED", minutesAgo: 20,
      rejectReason: letter === "A" ? "Egg curry just sold out — sorry!" : "Out of fresh orange juice right now.",
      items: [
        { menuItemId: byName(letter === "A" ? "Egg Curry (2 pcs)" : "Fresh Orange Juice").id, qty: 1 },
      ],
    },

    // Cancelled (older)
    {
      status: "CANCELLED", minutesAgo: 60,
      rejectReason: "Customer cancelled the order.",
      items: [
        { menuItemId: byName(letter === "A" ? "Coke 330ml" : "Cold Coffee").id, qty: 1 },
      ],
    },
  ];

  let ticketNumber = 1;
  for (const spec of specs) {
    const totalCents = spec.items.reduce((sum, l) => {
      const m = items.find((i) => i.id === l.menuItemId)!;
      return sum + m.price * l.qty;
    }, 0);

    const createdAt = new Date(Date.now() - spec.minutesAgo * 60_000);
    const approvedAt =
      spec.status !== "PENDING_CASHIER" && spec.status !== "REJECTED" && spec.status !== "CANCELLED"
        ? new Date(createdAt.getTime() + 30_000)
        : null;
    const readyAt = spec.status === "READY" || spec.status === "COMPLETED"
      ? new Date(createdAt.getTime() + 6 * 60_000)
      : null;
    const completedAt = spec.status === "COMPLETED"
      ? new Date(createdAt.getTime() + 10 * 60_000)
      : null;

    const token = `${letter}-${ticketNumber.toString().padStart(3, "0")}`;
    ticketNumber++;

    await prisma.order.create({
      data: {
        token,
        counterId: counter.id,
        guestPhone: spec.guestPhone ?? null,
        status: spec.status,
        paymentStatus: spec.payment ?? "UNPAID",
        rejectReason: spec.rejectReason ?? null,
        totalCents,
        // Use createdAt-ish score so older items have lower priority.
        priorityScore: Date.now() - spec.minutesAgo * 60_000,
        createdAt,
        approvedAt,
        readyAt,
        completedAt,
        items: {
          create: spec.items.map((l) => {
            const m = items.find((i) => i.id === l.menuItemId)!;
            return { menuItemId: l.menuItemId, qty: l.qty, unitPrice: m.price };
          }),
        },
      },
    });
  }

  console.log(`[seed] counter ${letter}: created ${specs.length} demo orders`);

  // Sync the Redis ticket counter to the highest token number we just wrote,
  // so the next INCR (nextToken) produces a fresh, non-colliding token.
  // We do this *after* flushdb() in main(), and we keep the key in sync with
  // lib/redis.ts k.ticketCounter so it can't drift.
  const highest = ticketNumber - 1; // ticketNumber was incremented past the last value
  await redis.set(k.ticketCounter(counter.id), highest);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
