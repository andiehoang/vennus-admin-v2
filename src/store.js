/* =================================================================
   DATA STORE
   -----------------------------------------------------------------
   No separate database — each collection is a JSON file committed
   to this app's own repo (DATA_REPO, under data/<name>.json). On
   boot, every collection is pulled down from GitHub into memory;
   every write updates memory immediately (so the request that made
   the change sees it right away) and then commits the new file in
   the background. A tiny per-file queue keeps concurrent writes to
   the same collection from racing each other's GitHub sha.
   ================================================================= */

const bcrypt = require("bcryptjs");
const github = require("./github");
const seedProducts = require("./seed/products.json");

const DATA_REPO = process.env.DATA_REPO || process.env.GITHUB_REPOSITORY || "";
const DATA_DIR = "data";

const DEFAULTS = {
  products: seedProducts,
  settings: {
    announcement: "Complimentary shipping on all Canadian orders over $150",
    theme: {},
    seo_description: "VENNUS Jewelry — quietly luxurious pearl necklaces, earrings, bracelets, and rings, designed in small batches."
  },
  users: [], // bootstrapped on first boot, see ensureBootstrapUser()
  media: [],
  subscribers: [],
  orders: [],
  events: []
};

const collections = {};
const shas = {};
const queues = {};

// Pageview/analytics events fire on every storefront page load — far
// too often to commit to GitHub one at a time (it would spam the
// repo's history and burn through the API's rate limit). They live
// in memory only, so a redeploy resets them; that's an acceptable
// trade for data that's inherently high-volume and non-critical,
// unlike products/orders/settings/users.
const VOLATILE = new Set(["events"]);

function file(name) { return `${DATA_DIR}/${name}.json`; }

/* Serializes writes to the same collection so two saves in flight
   at once can't stomp on each other's GitHub sha. */
function enqueue(name, task) {
  const prev = queues[name] || Promise.resolve();
  const next = prev.then(task, task);
  queues[name] = next.catch(() => {});
  return next;
}

async function load(name) {
  if (!DATA_REPO) {
    collections[name] = DEFAULTS[name];
    return;
  }
  const { value, sha } = await github.readJSON(process.env.DATA_GITHUB_TOKEN, DATA_REPO, file(name), DEFAULTS[name]);
  collections[name] = value;
  shas[name] = sha;
  if (!sha) {
    // Nothing committed yet for this collection — write the default
    // now so the repo reflects what the app is actually running on.
    await persist(name, `Seed ${name}.json`);
  }
}

async function persist(name, message) {
  if (!DATA_REPO || VOLATILE.has(name)) return;
  return enqueue(name, async () => {
    const sha = await github.writeJSON(process.env.DATA_GITHUB_TOKEN, DATA_REPO, file(name), collections[name], message, shas[name]);
    shas[name] = sha;
  });
}

async function init() {
  await Promise.all(Object.keys(DEFAULTS).map(load));
  await ensureBootstrapUser();
}

/* If there are no staff accounts yet (first boot), create one from
   env vars so there's a way to log in at all. Logged once, loudly,
   so it isn't missed — and only ever runs when the users list is
   genuinely empty. */
async function ensureBootstrapUser() {
  if (collections.users.length) return;
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!email || !password) {
    console.warn("No staff users exist yet, and BOOTSTRAP_ADMIN_EMAIL/BOOTSTRAP_ADMIN_PASSWORD aren't set — nobody will be able to log in. Set them and redeploy.");
    return;
  }
  const user = {
    id: 1,
    name: "Owner",
    email: email.toLowerCase(),
    passwordHash: await bcrypt.hash(password, 10),
    role: "owner",
    createdAt: new Date().toISOString()
  };
  collections.users.push(user);
  await persist("users", "Bootstrap owner account");
  console.log(`Bootstrap owner account created for ${user.email}. Log in and consider rotating the password from Users once you have another owner set up.`);
}

/* ---------- generic collection helpers ---------- */
function all(name) { return collections[name]; }
function set(name, value, message) {
  collections[name] = value;
  return persist(name, message || `Update ${name}.json`);
}

function nextId(name) {
  const rows = collections[name];
  return rows.reduce((max, r) => Math.max(max, r.id || 0), 0) + 1;
}

module.exports = { init, all, set, nextId, DATA_REPO };
