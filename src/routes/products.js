const express = require("express");
const store = require("../store");
const auth = require("../auth");

const router = express.Router();
router.use(auth.requireRole("viewer"));

router.get("/", (_req, res) => {
  res.json(store.all("products"));
});

router.get("/:id", (req, res) => {
  const product = store.all("products").find(p => p.id === +req.params.id);
  if (!product) return res.status(404).json({ error: "Product not found." });
  res.json(product);
});

router.post("/", auth.requireRole("editor"), async (req, res) => {
  const body = req.body || {};
  if (!body.name) return res.status(400).json({ error: "A name is required." });
  const product = {
    id: store.nextId("products"),
    name: body.name,
    category: body.category || "necklaces",
    price: Number(body.price) || 0,
    compareAt: body.compareAt != null ? Number(body.compareAt) : null,
    tag: body.tag || null,
    sku: body.sku || "",
    images: Array.isArray(body.images) ? body.images : [],
    description: body.description || "",
    details: Array.isArray(body.details) ? body.details : [],
    options: body.options || null,
    inStock: body.inStock !== false,
    quantity: Number(body.quantity) || 0
  };
  const products = store.all("products");
  products.push(product);
  await store.set("products", products, `Add product "${product.name}" via Vennus admin`);
  res.status(201).json(product);
});

router.put("/:id", auth.requireRole("editor"), async (req, res) => {
  const products = store.all("products");
  const i = products.findIndex(p => p.id === +req.params.id);
  if (i === -1) return res.status(404).json({ error: "Product not found." });
  products[i] = { ...products[i], ...req.body, id: products[i].id };
  await store.set("products", products, `Update product "${products[i].name}" via Vennus admin`);
  res.json(products[i]);
});

router.delete("/:id", auth.requireRole("admin"), async (req, res) => {
  const products = store.all("products");
  const i = products.findIndex(p => p.id === +req.params.id);
  if (i === -1) return res.status(404).json({ error: "Product not found." });
  const [removed] = products.splice(i, 1);
  await store.set("products", products, `Remove product "${removed.name}" via Vennus admin`);
  res.json({ ok: true });
});

module.exports = router;
