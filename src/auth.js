const jwt = require("jsonwebtoken");
const store = require("./store");

const ROLE_RANK = { viewer: 1, editor: 2, admin: 3, owner: 4 };
const SECRET = process.env.JWT_SECRET;

function sign(user) {
  return jwt.sign({ sub: user.id }, SECRET, { expiresIn: "30d" });
}

function findUser(id) {
  return store.all("users").find(u => u.id === id);
}
function findUserByEmail(email) {
  return store.all("users").find(u => u.email === String(email || "").toLowerCase());
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

/* Attaches req.user when a valid Bearer token is present; otherwise
   leaves it undefined (routes decide for themselves whether that's
   acceptable via requireRole). */
function attachUser(req, _res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (token) {
    try {
      const payload = jwt.verify(token, SECRET);
      const user = findUser(payload.sub);
      if (user) req.user = user;
    } catch { /* invalid/expired token — req.user stays unset */ }
  }
  next();
}

function requireRole(minRole) {
  const minRank = ROLE_RANK[minRole] || 1;
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Sign in required." });
    if ((ROLE_RANK[req.user.role] || 0) < minRank) {
      return res.status(403).json({ error: "Your role doesn't allow this." });
    }
    next();
  };
}

module.exports = { ROLE_RANK, sign, findUser, findUserByEmail, publicUser, attachUser, requireRole };
