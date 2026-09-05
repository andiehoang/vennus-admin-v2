const path = require("path");
const github = require("./github");

const STOREFRONT_REPO = process.env.STOREFRONT_REPO || "andiehoang/vennus-jewelry";
const VIDEO_EXT = new Set([".mp4", ".mov", ".webm", ".m4v"]);

function sanitizeName(originalName) {
  const ext = path.extname(originalName).toLowerCase();
  const base = path.basename(originalName, ext)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "file";
  return { name: `${Date.now()}-${base}${ext}`, ext };
}

/* Commits one uploaded file into vennus-jewelry/images/ and returns
   the { url, type } the storefront expects — a path relative to the
   repo root, which every page on the site can already resolve since
   they all live at the root alongside images/. */
async function commitUpload(fileBuffer, originalName) {
  const { name, ext } = sanitizeName(originalName);
  const filePath = `images/${name}`;
  const base64 = fileBuffer.toString("base64");
  await github.putFile(STOREFRONT_REPO, filePath, base64, `Add ${name} via Vennus admin`);
  return {
    url: filePath,
    type: VIDEO_EXT.has(ext) ? "video" : "image"
  };
}

module.exports = { commitUpload };
