import cron from "node-cron";
import { prisma } from "./prisma";
import { promoteOldOrders } from "./queue";
import { ROOMS, EV, type OrderStatusEvent } from "./socket-events";
import { getIo } from "./bus";

let started = false;

export function startPromoter() {
  if (started) return;
  started = true;

  // Every 10s, for each active counter, bump priority of orders waiting > 90s.
  cron.schedule("*/10 * * * * *", async () => {
    try {
      const counters = await prisma.counter.findMany({ select: { id: true } });
      for (const c of counters) {
        const bumpedIds = await promoteOldOrders(c.id);
        if (bumpedIds.length === 0) continue;

        // Persist the new priorityScore in Postgres so the staff views
        // (which sort by priorityScore desc from the DB) reflect the
        // anti-starvation bump. Without this, the kitchen / cashier UI
        // would show a stale ordering because the original priorityScore
        // (Date.now() at creation) never changes after submit. The score
        // is just `now + boost`, monotonic per counter.
        const newScore = Date.now() + 50;
        try {
          await prisma.order.updateMany({
            where: { id: { in: bumpedIds }, status: { in: ["PENDING_CASHIER", "APPROVED"] } },
            data: { priorityScore: newScore },
          });
        } catch (err) {
          console.error("[promoter] postgres update failed", err);
        }

        // Only refetch + emit status for the orders whose scores actually changed,
        // then broadcast a single queuePromoted so kitchen/cashier can reorder.
        const orders = await prisma.order.findMany({
          where: { id: { in: bumpedIds }, status: { in: ["PENDING_CASHIER", "APPROVED"] } },
          select: { id: true, token: true, priorityScore: true, status: true },
        });
        const io = getIo();
        for (const o of orders) {
          const payload: OrderStatusEvent = {
            orderId: o.id,
            token: o.token,
            counterId: c.id,
            status: o.status as any,
            priorityScore: o.priorityScore,
          };
          io?.to(ROOMS.student(o.id))
            .to(ROOMS.cashier(c.id))
            .to(ROOMS.kitchen(c.id))
            .to(ROOMS.counter(c.id))
            .emit(EV.orderStatus, payload);
        }
        io?.to(ROOMS.kitchen(c.id))
          .to(ROOMS.cashier(c.id))
          .emit(EV.queuePromoted, { counterId: c.id, bumped: bumpedIds.length });
      }
    } catch (err) {
      console.error("[promoter]", err);
    }
  });
}
