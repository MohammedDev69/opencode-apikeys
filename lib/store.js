"use strict";

const fs = require("fs");
const path = require("path");

function stamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

function readKey(file) {
  try {
    const value = fs.readFileSync(file, "utf8").trim();
    return { exists: true, value };
  } catch (e) {
    if (e.code === "ENOENT") return { exists: false, value: "" };
    throw e;
  }
}

function backup(file) {
  if (!fs.existsSync(file)) return null;

  // Timestamps have one-second resolution, so guard against collisions:
  // never overwrite an existing backup.
  const base = `${file}.bak-${stamp()}`;
  let target = base;
  let n = 1;
  while (fs.existsSync(target)) {
    target = `${base}-${n++}`;
  }

  fs.copyFileSync(file, target);
  return target;
}

/** Atomic write: temp file + rename, owner-only permissions where supported. */
function writeKey(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, value + "\n", { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/** Deletes the key file but keeps a timestamped copy. Returns backup path. */
function deleteKey(file) {
  const saved = backup(file);
  fs.unlinkSync(file);
  return saved;
}

function validateKey(input) {
  const value = String(input ?? "").trim().replace(/^["']|["']$/g, "");
  if (!value) return { ok: false, reason: "key is empty" };
  if (/\s/.test(value)) return { ok: false, reason: "key contains whitespace" };
  if (value.length < 8) return { ok: false, reason: "key is too short (minimum 8 characters)" };
  return { ok: true, value };
}

function mask(value) {
  const v = String(value ?? "");
  if (!v) return "";
  if (v.length <= 10) return v.slice(0, 2) + "…" + v.slice(-2);
  return v.slice(0, 8) + "…" + v.slice(-4);
}

module.exports = { readKey, writeKey, deleteKey, backup, validateKey, mask, stamp };
