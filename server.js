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

// The storefront (a different origin, served from GitHub Pages)
// calls this API directly from the browser, so it needs to be
// allowed in. The admin dashboard itself ALSO needs to be allowed —
// it's served from this same app, but browsers still attach an
// Origin header to same-origin POST/PUT/DELETE requests, and this
// check runs against any request that has one, same-origin or not.
// RENDER_EXTERNAL_URL is set automatically by Render to this
// service's own URL, so that's included without needing to hardcode
// or manually configure it.
const allowedOrigins = new Set(
  (process.env.CORS_ORIGINS || "https://andiehoang.github.io")
    .split(",").map(s => s.trim()).filter(Boolean)
);
if (process.env.RENDER_EXTERNAL_URL) allowedOrigins.add(process.env.RENDER_EXTERNAL_URL);

app.use(cors({
  origin(origin, cb) {
    // No Origin header (curl, server-to-server) — allow. Otherwise
    // it must be on the allow-list.
    if (!origin || allowedOrigins.has(origin)) return cb(null, true);
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
