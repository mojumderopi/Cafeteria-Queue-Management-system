// End-to-end check that exercises the real public + staff APIs with a proper
// cookie jar (mimicking the browser). Designed to be re-runnable against a
// freshly-seeded database.
const BASE = process.env.SMOKE_BASE ?? "http://localhost:3000";

interface CookieJar {
  store: Map<string, string>;
  header(): string;
  absorb(setCookie: string | null): void;
}
function newJar(): CookieJar {
  const store = new Map<string, string>();
  return {
    store,
    header() {
      return [...store.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    },
    absorb(setCookie) {
      if (!setCookie) return;
      // Several Set-Cookie headers can be combined with comma, but cookies
      // themselves use commas only inside Expires dates. Use a forgiving split
      // on ", " (note space) and ignore malformed pairs.
      const parts = setCookie.split(/, (?=[A-Za-z0-9_-]+=)/);
      for (const p of parts) {
        const seg = p.split(";")[0];
        const eq = seg.indexOf("=");
        if (eq < 0) continue;
        const name = seg.slice(0, eq).trim();
        const val = seg.slice(eq + 1).trim();
        if (!name) continue;
        if (/^Expires=/i.test(p) && val === "") continue; // cookie deletion
        store.set(name, val);
      }
    },
  };
}

interface Resp {
  status: number;
  body: any;
}
async function req(
  path: string,
  init: RequestInit = {},
  jar?: CookieJar
): Promise<Resp> {
  const headers = new Headers(init.headers);
  if (jar) headers.set("Cookie", jar.header());
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  jar?.absorb(res.headers.get("set-cookie"));
  const text = await res.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch { /* leave as text */ }
  return { status: res.status, body };
}

let passed = 0;
let failed = 0;
const failures: string[] = [];
function check(label: string, ok: boolean, info: string = "") {
  if (ok) {
    passed++;
    console.log(`  PASS  ${label}${info ? "  — " + info : ""}`);
  } else {
    failed++;
    failures.push(`${label}${info ? "  — " + info : ""}`);
    console.log(`  FAIL  ${label}${info ? "  — " + info : ""}`);
  }
}

async function main() {
  console.log(`# E2E against ${BASE}`);

  // --- 1) menu ---
  const menu = await req("/api/counters/canteen-a");
  check("GET /api/counters/canteen-a → 200", menu.status === 200, `items=${menu.body.menu?.length}`);
  const available = menu.body.menu?.filter((m: any) => m.isAvailable && m.stockRemaining > 0) ?? [];
  if (available.length < 2) throw new Error("not enough stock to test");
  const a = available[0];
  const b = available[1];
  const initialA = a.stockRemaining;
  const initialB = b.stockRemaining;
  const counterA = menu.body.counter;

  // --- 2) place order ---
  const placed = await req("/api/orders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      counterSlug: "canteen-a",
      items: [{ menuItemId: a.id, qty: 1 }],
      guestPhone: "01712345678",
      guestName: "E2E Test",
    }),
  });
  check("POST /api/orders → 200", placed.status === 200, `token=${placed.body.order?.token}`);
  const orderId = placed.body.order?.id;
  const orderToken = placed.body.order?.token;

  // --- 3) stock decrement ---
  const menu2 = await req("/api/counters/canteen-a");
  const a2 = menu2.body.menu.find((m: any) => m.id === a.id);
  check("stock decremented after order", a2.stockRemaining === initialA - 1, `${initialA} → ${a2.stockRemaining}`);

  // --- 4) qty cap enforcement ---
  const overcap = await req("/api/orders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ counterSlug: "canteen-a", items: [{ menuItemId: a.id, qty: 21 }] }),
  });
  check("qty > 20 → 400 bad_request", overcap.status === 400 && overcap.body.error === "bad_request", `status=${overcap.status}`);

  // --- 4b) cap-ok qty > stock ---
  const overstock = await req("/api/orders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ counterSlug: "canteen-a", items: [{ menuItemId: a.id, qty: 20 }] }),
  });
  check("qty 20 vs short stock → 409 stock_short", overstock.status === 409 && overstock.body.error === "stock_short", `status=${overstock.status}`);

  // --- 5) stock unchanged after failed orders ---
  const menu3 = await req("/api/counters/canteen-a");
  const a3 = menu3.body.menu.find((m: any) => m.id === a.id);
  check("stock unchanged after failed orders", a3.stockRemaining === a2.stockRemaining, `${a2.stockRemaining} → ${a3.stockRemaining}`);

  // --- 6) staff login ---
  const staff = newJar();
  const login = await req("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone: "01700000001", password: "cashier123" }),
  }, staff);
  check("POST /api/auth/login (cashier) → 200", login.status === 200 && login.body.role === "CASHIER", `role=${login.body.role}`);

  // --- 7) staff sees PENDING order ---
  const pending = await req(`/api/staff/orders?counterId=${counterA.id}&status=PENDING_CASHIER`, {}, staff);
  const seen = (pending.body.orders ?? []).find((o: any) => o.id === orderId);
  check("cashier sees the new order in PENDING", pending.status === 200 && !!seen, `count=${pending.body.orders?.length}`);

  // --- 8) unauth staff → 403 ---
  const unauth = await req(`/api/staff/orders?counterId=${counterA.id}&status=APPROVED`);
  check("unauth /api/staff/orders → 403", unauth.status === 403 && unauth.body.error === "forbidden", `status=${unauth.status}`);

  // --- 9) approve ---
  const approve = await req(`/api/cashier/orders/${orderId}/approve`, { method: "POST" }, staff);
  check("POST approve → 200", approve.status === 200 && approve.body.status === "APPROVED", `status=${approve.body.status}`);

  // --- 10) approve again → 409 bad_state ---
  const approve2 = await req(`/api/cashier/orders/${orderId}/approve`, { method: "POST" }, staff);
  check("approve again → 409 bad_state", approve2.status === 409 && approve2.body.error === "bad_state", `status=${approve2.status}`);

  // --- 11) order status now APPROVED ---
  const afterApprove = await req(`/api/orders/${orderId}`);
  check("order status is APPROVED", afterApprove.body.order.status === "APPROVED", `status=${afterApprove.body.order.status}`);

  // --- 12) kitchen login + start (kitchen user bound to canteen-a) ---
  const kitchen = newJar();
  const klogin = await req("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone: "01700000004", password: "kitchen123" }),
  }, kitchen);
  check("kitchen login → 200", klogin.status === 200 && klogin.body.role === "KITCHEN", `role=${klogin.body.role}`);

  const start = await req(`/api/kitchen/orders/${orderId}/start`, { method: "POST" }, kitchen);
  check("POST start → 200", start.status === 200 && start.body.ok === true, `status=${start.body.ok}`);
  // verify side-effect via the public order API
  const afterStart = await req(`/api/orders/${orderId}`);
  check("order status is PREPARING after start", afterStart.body.order.status === "PREPARING", `status=${afterStart.body.order.status}`);

  // --- 13) start again → 409 ---
  const start2 = await req(`/api/kitchen/orders/${orderId}/start`, { method: "POST" }, kitchen);
  check("start again → 409 bad_state", start2.status === 409 && start2.body.error === "bad_state", `status=${start2.status}`);

  // --- 14) ready ---
  const ready = await req(`/api/kitchen/orders/${orderId}/ready`, { method: "POST" }, kitchen);
  check("POST ready → 200", ready.status === 200 && ready.body.ok === true, `ok=${ready.body.ok}`);
  const afterReady = await req(`/api/orders/${orderId}`);
  check("order status is READY after ready", afterReady.body.order.status === "READY", `status=${afterReady.body.order.status}`);

  // --- 15) ready again → 409 ---
  const ready2 = await req(`/api/kitchen/orders/${orderId}/ready`, { method: "POST" }, kitchen);
  check("ready again → 409 bad_state", ready2.status === 409 && ready2.body.error === "bad_state", `status=${ready2.status}`);

  // --- 16) collect with wrong token → 400 ---
  const wrong = await req(`/api/cashier/orders/${orderId}/collect`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: "WRONG" }),
  }, staff);
  check("collect wrong token → 400", wrong.status === 400, `status=${wrong.status}`);

  // --- 17) collect with right token → 200 ---
  const collect = await req(`/api/cashier/orders/${orderId}/collect`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: orderToken }),
  }, staff);
  check("collect correct token → 200", collect.status === 200, `status=${collect.status}`);

  // --- 18) final state ---
  const final = await req(`/api/orders/${orderId}`);
  check("final status COMPLETED + payment PAID", final.body.order.status === "COMPLETED" && final.body.order.paymentStatus === "PAID",
    `status=${final.body.order.status} payment=${final.body.order.paymentStatus}`);

  // --- 19) collect again → 409 ---
  const collect2 = await req(`/api/cashier/orders/${orderId}/collect`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: orderToken }),
  }, staff);
  check("collect again → 409 bad_state", collect2.status === 409 && collect2.body.error === "bad_state", `status=${collect2.status}`);

  // --- 20) place + reject + verify stock is released ---
  const rejectOrder = await req("/api/orders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ counterSlug: "canteen-a", items: [{ menuItemId: b.id, qty: 2 }] }),
  });
  const rjId = rejectOrder.body.order.id;
  const stockBeforeReject = (await req("/api/counters/canteen-a")).body.menu.find((m: any) => m.id === b.id).stockRemaining;
  const rej = await req(`/api/cashier/orders/${rjId}/reject`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reason: "E2E reject" }),
  }, staff);
  check("POST reject → 200", rej.status === 200 && rej.body.status === "REJECTED", `status=${rej.body.status}`);
  const stockAfterReject = (await req("/api/counters/canteen-a")).body.menu.find((m: any) => m.id === b.id).stockRemaining;
  check("stock released after reject", stockAfterReject === stockBeforeReject + 2, `${stockBeforeReject} → ${stockAfterReject}`);

  // --- 21) double reject → 409 ---
  const rej2 = await req(`/api/cashier/orders/${rjId}/reject`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reason: "again" }),
  }, staff);
  check("reject again → 409 bad_state", rej2.status === 409 && rej2.body.error === "bad_state", `status=${rej2.status}`);

  // --- 22) place + cancel + verify stock released ---
  const cancelOrder = await req("/api/orders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ counterSlug: "canteen-a", items: [{ menuItemId: a.id, qty: 1 }] }),
  });
  const cnId = cancelOrder.body.order.id;
  const stockBeforeCancel = (await req("/api/counters/canteen-a")).body.menu.find((m: any) => m.id === a.id).stockRemaining;
  const cancel = await req(`/api/orders/${cnId}/cancel`, { method: "POST" }, staff);
  check("POST cancel → 200", cancel.status === 200 && cancel.body.ok === true, `status=${cancel.status}`);
  const stockAfterCancel = (await req("/api/counters/canteen-a")).body.menu.find((m: any) => m.id === a.id).stockRemaining;
  check("stock released after cancel", stockAfterCancel === stockBeforeCancel + 1, `${stockBeforeCancel} → ${stockAfterCancel}`);

  // --- 23) cross-role: cashier trying kitchen endpoint on a fresh order ---
  const fresh = await req("/api/orders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ counterSlug: "canteen-a", items: [{ menuItemId: a.id, qty: 1 }] }),
  });
  const freshId = fresh.body.order.id;
  await req(`/api/cashier/orders/${freshId}/approve`, { method: "POST" }, staff);
  // cashier should not be able to use kitchen routes
  const wrongRole = await req(`/api/kitchen/orders/${freshId}/start`, { method: "POST" }, staff);
  check("cashier cannot start kitchen order → 403", wrongRole.status === 403, `status=${wrongRole.status}`);

  // --- 23b) per-counter isolation: cashier A cannot read canteen-b orders ---
  const menuB = await req("/api/counters/canteen-b");
  const counterB = menuB.body.counter;
  const cross = await req(`/api/staff/orders?counterId=${counterB.id}&status=APPROVED,PREPARING,READY,PENDING_CASHIER`, {}, staff);
  check("cashier A cannot list canteen-b orders → 403", cross.status === 403, `status=${cross.status}`);

  // --- 23c) kitchen A cannot start a canteen-b order ---
  const itemB = menuB.body.menu.find((m: any) => m.isAvailable && m.stockRemaining > 0);
  if (!itemB) throw new Error("no stock on canteen-b");
  const freshB = await req("/api/orders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ counterSlug: "canteen-b", items: [{ menuItemId: itemB.id, qty: 1 }] }),
  });
  if (freshB.status !== 200) throw new Error(`canteen-b order failed: status=${freshB.status} body=${JSON.stringify(freshB.body)}`);
  const cashierB = newJar();
  await req("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone: "01700000003", password: "cashier123" }),
  }, cashierB);
  await req(`/api/cashier/orders/${freshB.body.order.id}/approve`, { method: "POST" }, cashierB);
  const wrongCounter = await req(`/api/kitchen/orders/${freshB.body.order.id}/start`, { method: "POST" }, kitchen);
  check("kitchen A cannot start canteen-b order → 403", wrongCounter.status === 403, `status=${wrongCounter.status}`);

  // --- 23d) admin sees all counters ---
  const admin = newJar();
  const alogin = await req("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone: "01700000099", password: "admin123" }),
  }, admin);
  check("admin login → 200", alogin.status === 200 && alogin.body.role === "ADMIN", `role=${alogin.body.role}`);
  const counters = await req("/api/staff/counters", {}, admin);
  check("admin /api/staff/counters lists both", counters.status === 200 && counters.body.counters?.length >= 2, `count=${counters.body.counters?.length}`);

  // --- 25) wrong-password login ---
  const bad = await req("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone: "01700000001", password: "nope" }),
  });
  check("wrong password → 401", bad.status === 401 && bad.body.error === "invalid_credentials", `status=${bad.status}`);

  console.log(`\n# ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("# Failures:");
    failures.forEach((f) => console.log("  - " + f));
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
