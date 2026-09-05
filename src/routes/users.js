const express = require("express");
const bcrypt = require("bcryptjs");
const store = require("../store");
const auth = require("../auth");

const router = express.Router();
router.use(auth.requireRole("admin"));

router.get("/", (_req, res) => {
  res.json(store.all("users").map(auth.publicUser));
});

router.post("/", auth.requireRole("owner"), async (req, res) => {
  const { name, email, password, role } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: "Name, email, and password are required." });
  if (!["viewer", "editor", "admin", "owner"].includes(role)) return res.status(400).json({ error: "Invalid role." });
  if (auth.findUserByEmail(email)) return res.status(409).json({ error: "That email is already in use." });

  const user = {
    id: store.nextId("users"),
    name,
    email: email.toLowerCase(),
    passwordHash: await bcrypt.hash(password, 10),
    role,
    createdAt: new Date().toISOString()
  };
  const users = store.all("users");
  users.push(user);
  await store.set("users", users, `Add staff account ${user.email} via Vennus admin`);
  res.status(201).json(auth.publicUser(user));
});

router.put("/:id", auth.requireRole("owner"), async (req, res) => {
  const users = store.all("users");
  const i = users.findIndex(u => u.id === +req.params.id);
  if (i === -1) return res.status(404).json({ error: "User not found." });

  const { name, role, password } = req.body || {};
  if (name) users[i].name = name;
  if (role) {
    if (!["viewer", "editor", "admin", "owner"].includes(role)) return res.status(400).json({ error: "Invalid role." });
    if (users[i].id === req.user.id && role !== "owner") {
      return res.status(400).json({ error: "You can't remove your own owner role." });
    }
    users[i].role = role;
  }
  if (password) users[i].passwordHash = await bcrypt.hash(password, 10);
  await store.set("users", users, `Update staff account ${users[i].email} via Vennus admin`);
  res.json(auth.publicUser(users[i]));
});

router.delete("/:id", auth.requireRole("owner"), async (req, res) => {
  if (+req.params.id === req.user.id) return res.status(400).json({ error: "You can't remove your own account." });
  const users = store.all("users");
  const i = users.findIndex(u => u.id === +req.params.id);
  if (i === -1) return res.status(404).json({ error: "User not found." });
  const [removed] = users.splice(i, 1);
  await store.set("users", users, `Remove staff account ${removed.email} via Vennus admin`);
  res.json({ ok: true });
});

module.exports = router;
