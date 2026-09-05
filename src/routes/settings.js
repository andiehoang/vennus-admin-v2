const express = require("express");
const store = require("../store");
const auth = require("../auth");

const router = express.Router();
router.use(auth.requireRole("viewer"));

router.get("/", (_req, res) => res.json(store.all("settings")));

router.put("/", auth.requireRole("editor"), async (req, res) => {
  const updated = { ...store.all("settings"), ...(req.body || {}) };
  await store.set("settings", updated, "Update settings via Vennus admin");
  res.json(updated);
});

module.exports = router;
