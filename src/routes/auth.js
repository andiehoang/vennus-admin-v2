const express = require("express");
const bcrypt = require("bcryptjs");
const auth = require("../auth");

const router = express.Router();

router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  const user = auth.findUserByEmail(email);
  if (!user || !(await bcrypt.compare(password || "", user.passwordHash))) {
    return res.status(401).json({ error: "Incorrect email or password." });
  }
  res.json({ token: auth.sign(user), user: auth.publicUser(user) });
});

router.get("/me", auth.requireRole("viewer"), (req, res) => {
  res.json({ user: auth.publicUser(req.user) });
});

// JWTs here are stateless (no server-side session to clear) — this
// exists so the storefront's sign-out button has something to call.
router.post("/logout", (_req, res) => res.json({ ok: true }));

module.exports = router;
