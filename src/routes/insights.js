const express = require("express");
const store = require("../store");
const auth = require("../auth");

const router = express.Router();
router.use(auth.requireRole("viewer"));

router.get("/orders", (_req, res) => {
  res.json([...store.all("orders")].reverse());
});

router.get("/subscribers", (_req, res) => {
  res.json([...store.all("subscribers")].reverse());
});

router.get("/analytics/summary", (_req, res) => {
  const events = store.all("events");
  const products = store.all("products");
  const orders = store.all("orders");

  const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const recent = events.filter(e => new Date(e.ts).getTime() >= since);

  const byDay = {};
  const byType = {};
  for (const e of recent) {
    const day = e.ts.slice(0, 10);
    byDay[day] = (byDay[day] || 0) + 1;
    byType[e.type] = (byType[e.type] || 0) + 1;
  }

  const revenue = orders.reduce((sum, o) => sum + (o.subtotal || 0), 0);
  const lowStock = products.filter(p => p.inStock && p.quantity <= 5);

  res.json({
    pageviews30d: byType.pageview || 0,
    eventsByDay: Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b)).map(([day, count]) => ({ day, count })),
    eventsByType: byType,
    orderCount: orders.length,
    revenue,
    productCount: products.length,
    lowStock: lowStock.map(p => ({ id: p.id, name: p.name, quantity: p.quantity }))
  });
});

module.exports = router;
