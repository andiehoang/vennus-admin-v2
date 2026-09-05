const express = require("express");
const store = require("../store");

const router = express.Router();
const MAX_EVENTS = 5000; // keep the events file from growing without bound

router.get("/products", (_req, res) => {
  res.json(store.all("products"));
});

router.get("/settings", (_req, res) => {
  res.json(store.all("settings"));
});

router.post("/subscribe", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) return res.status(400).json({ error: "A valid email is required." });
  const subs = store.all("subscribers");
  if (!subs.some(s => s.email === email)) {
    subs.push({ email, subscribedAt: new Date().toISOString() });
    await store.set("subscribers", subs, `Newsletter signup: ${email}`);
  }
  res.json({ ok: true });
});

router.post("/orders", async (req, res) => {
  const { items, customer } = req.body || {};
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: "Your bag is empty." });

  const products = store.all("products");
  let subtotal = 0;
  const lines = [];
  for (const line of items) {
    const product = products.find(p => p.id === +line.productId);
    if (!product) return res.status(400).json({ error: `Product ${line.productId} no longer exists.` });
    const qty = Math.max(1, +line.quantity || 1);
    if (product.inStock && product.quantity < qty) {
      return res.status(400).json({ error: `Only ${product.quantity} of "${product.name}" left in stock.` });
    }
    subtotal += product.price * qty;
    lines.push({ productId: product.id, name: product.name, price: product.price, quantity: qty, option: line.option || null });
    product.quantity = Math.max(0, product.quantity - qty);
    if (product.quantity === 0) product.inStock = false;
  }

  const orders = store.all("orders");
  const order = {
    id: store.nextId("orders"),
    items: lines,
    subtotal,
    customer: customer || null,
    status: "received",
    createdAt: new Date().toISOString()
  };
  orders.push(order);

  await Promise.all([
    store.set("orders", orders, `New order #${order.id}`),
    store.set("products", products, `Decrement stock for order #${order.id}`)
  ]);

  // New customer email seen for the first time — track it too, same
  // as an explicit newsletter signup would.
  if (customer?.email) {
    const email = String(customer.email).trim().toLowerCase();
    const subs = store.all("subscribers");
    if (!subs.some(s => s.email === email)) {
      subs.push({ email, subscribedAt: new Date().toISOString(), fromOrder: order.id });
      await store.set("subscribers", subs, `Customer from order #${order.id}: ${email}`);
    }
  }

  res.status(201).json(order);
});

router.post("/track", async (req, res) => {
  // Analytics must never slow down or break the storefront — ack
  // immediately, then record on a best-effort basis.
  res.json({ ok: true });
  try {
    const { type, path, referrer, session_id, meta } = req.body || {};
    if (!type) return;
    const events = store.all("events");
    events.push({ type, path: path || "", referrer: referrer || "", session_id: session_id || "", meta: meta || null, ts: new Date().toISOString() });
    while (events.length > MAX_EVENTS) events.shift();
    await store.set("events", events, `Track event: ${type}`);
  } catch { /* best-effort */ }
});

module.exports = router;
