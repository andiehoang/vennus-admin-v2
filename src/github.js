/* =================================================================
   GitHub Contents API helper.
   -----------------------------------------------------------------
   Two things in this app are persisted by committing straight to a
   GitHub repo instead of a database:
     1. This app's own data (products/settings/users/media/etc, as
        JSON files in DATA_REPO) — so a Render redeploy never loses
        anything, since the files are read back from GitHub on boot.
     2. Uploaded product/site photos and videos, committed into
        vennus-jewelry's images/ folder (STOREFRONT_REPO), so they
        serve from the exact URLs the storefront already expects.
   Both use the same token (GITHUB_TOKEN), which needs Contents:
   read/write on both repos.
   ================================================================= */

const API = "https://api.github.com";

function assertToken() {
  if (!process.env.GITHUB_TOKEN) {
    throw new Error("GITHUB_TOKEN is not set — see .env.example.");
  }
}

async function ghFetch(path, opts = {}) {
  assertToken();
  const res = await fetch(API + path, {
    ...opts,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      ...opts.headers
    }
  });
  return res;
}

/* Get a file's current content + sha (sha is required to update or
   delete it later — GitHub's Contents API is optimistic-locked on
   it). Returns null if the file doesn't exist yet. */
async function getFile(repo, filePath, branch = "main") {
  const res = await ghFetch(`/repos/${repo}/contents/${encodeURI(filePath)}?ref=${branch}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub getFile ${filePath} failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return {
    sha: data.sha,
    content: Buffer.from(data.content, "base64")
  };
}

/* Create or update a file. base64Content is the raw bytes, already
   base64-encoded (works for text and binary alike). Pass the sha
   from getFile() when updating an existing file; omit it to create
   a new one. */
async function putFile(repo, filePath, base64Content, message, sha, branch = "main") {
  const res = await ghFetch(`/repos/${repo}/contents/${encodeURI(filePath)}`, {
    method: "PUT",
    body: JSON.stringify({
      message,
      content: base64Content,
      branch,
      ...(sha ? { sha } : {})
    })
  });
  if (!res.ok) throw new Error(`GitHub putFile ${filePath} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/* Convenience wrapper for the JSON data store: reads/writes a JS
   value as pretty-printed JSON, handling the sha dance internally. */
async function readJSON(repo, filePath, fallback) {
  const file = await getFile(repo, filePath);
  if (!file) return { value: fallback, sha: null };
  try {
    return { value: JSON.parse(file.content.toString("utf8")), sha: file.sha };
  } catch {
    return { value: fallback, sha: file.sha };
  }
}

async function writeJSON(repo, filePath, value, message, knownSha) {
  const body = Buffer.from(JSON.stringify(value, null, 2), "utf8").toString("base64");
  let sha = knownSha;
  if (sha === undefined) {
    const existing = await getFile(repo, filePath);
    sha = existing ? existing.sha : undefined;
  }
  const result = await putFile(repo, filePath, body, message, sha || undefined);
  return result.content.sha;
}

module.exports = { getFile, putFile, readJSON, writeJSON };
