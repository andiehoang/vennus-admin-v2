const express = require("express");
const multer = require("multer");
const store = require("../store");
const auth = require("../auth");
const { commitUpload } = require("../media");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 } // 25MB — generous enough for short product videos
});

const router = express.Router();
router.use(auth.requireRole("viewer"));

router.get("/", (_req, res) => {
  // Most recently uploaded first, so it's what you see when picking.
  res.json([...store.all("media")].reverse());
});

router.post("/", auth.requireRole("editor"), upload.array("files", 10), async (req, res) => {
  if (!req.files || !req.files.length) return res.status(400).json({ error: "No files were uploaded." });
  try {
    const uploaded = [];
    // Committed one at a time (not Promise.all) — concurrent commits
    // to the same repo/branch would race each other's base sha.
    for (const f of req.files) {
      const media = await commitUpload(f.buffer, f.originalname);
      uploaded.push({ ...media, uploadedAt: new Date().toISOString() });
    }
    const all = store.all("media");
    all.push(...uploaded);
    await store.set("media", all, `Add ${uploaded.length} file(s) via Vennus admin`);
    res.json({ files: uploaded });
  } catch (err) {
    res.status(502).json({ error: "Upload failed: " + err.message });
  }
});

module.exports = router;
