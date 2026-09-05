const path = require("path");
const express = require("express");
const cors = require("cors");

const store = require("./src/store");
const auth = require("./src/auth");

const REQUIRED_ENV = ["JWT_SECRET", "DATA_GITHUB_TOKEN", "DATA_REPO", "STOREFRONT_GITHUB_TOKEN"];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length) {
  console.error(`Missing required environment variable(s): ${missing.join(", ")}. See .env.example.`);
  process.exit(1);
}

const app = express();

// The storefront (served from GitHub Pages, a different origin) calls
// this API directly from the browser, so it needs to be allowed in.
const allowedOrigins = (process.env.CORS_ORIGINS || "https://andiehoang.github.io")
  .split(",").map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin(origin, cb) {
    // No Origin header (curl, server-to-server, same-origin admin
    // pages) — allow. Otherwise it must be on the allow-list.
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error("Not allowed by CORS"));
  }
}));

app.use(express.json({ limit: "2mb" }));
app.use(auth.attachUser);

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.use("/api/auth", require("./src/routes/auth"));
app.use("/api/products", require("./src/routes/products"));
app.use("/api/media", require("./src/routes/media"));
app.use("/api/settings", require("./src/routes/settings"));
app.use("/api/users", require("./src/routes/users"));
app.use("/api/public", require("./src/routes/public"));
app.use("/api", require("./src/routes/insights")); // /api/orders, /api/subscribers, /api/analytics/summary

// The admin dashboard itself — a static single-page app.
app.use("/admin", express.static(path.join(__dirname, "public/admin")));
app.get("/admin/*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public/admin/index.html"));
});
app.get("/", (_req, res) => res.redirect("/admin"));

// Keep error shape consistent with what the storefront/admin already
// expect ({ error: "..." }), instead of leaking a stack trace.
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || "Something went wrong." });
});

const PORT = process.env.PORT || 4000;
store.init()
  .then(() => {
    app.listen(PORT, () => console.log(`Vennus admin listening on :${PORT}`));
  })
  .catch(err => {
    console.error("Failed to load data from GitHub on boot:", err);
    process.exit(1);
  });
