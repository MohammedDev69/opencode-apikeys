"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { shortPath } = require("./config");

/**
 * The vault is a single JSON file holding every stored key per provider.
 * Exactly one key per provider is "active"; its value is mirrored into the
 * `{file:...}` path that OpenCode actually reads.
 *
 * Shape:
 * {
 *   "version": 1,
 *   "providers": {
 *     "vyce": {
 *       "active": "a1b2",
 *       "keys": [
 *         { "id": "a1b2", "label": "primary", "key": "sk-...", "added": "2026-11-17T..." }
 *       ]
 *     }
 *   }
 * }
 */

function defaultVaultPath() {
  return path.join(os.homedir(), ".config", "opencode", "apikeys.vault.json");
}

/** Vault location, overridable for testing via APIKEYS_VAULT. */
function resolveVaultPath() {
  const override = process.env.APIKEYS_VAULT;
  return override ? path.resolve(override) : defaultVaultPath();
}

function emptyVault() {
  return { version: 1, providers: {} };
}

function loadVault(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return emptyVault();
    throw new Error(`Cannot read vault ${shortPath(file)}: ${e.message}`);
  }

  try {
    const data = JSON.parse(text);
    return {
      version: 1,
      providers: data && typeof data.providers === "object" && data.providers ? data.providers : {},
    };
  } catch (e) {
    throw new Error(`Vault ${shortPath(file)} is not valid JSON: ${e.message}`);
  }
}

function saveVault(file, vault) {
  // Drop providers that no longer hold any key.
  const providers = {};
  for (const [name, state] of Object.entries(vault.providers || {})) {
    if (state && Array.isArray(state.keys) && state.keys.length) {
      providers[name] = { active: state.active ?? null, keys: state.keys };
    }
  }
  const payload = { version: 1, providers };

  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, file);
  return file;
}

function now() {
  return new Date().toISOString();
}

function newId(keys) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const id = crypto.randomBytes(2).toString("hex");
    if (!keys.some((k) => k.id === id)) return id;
  }
  throw new Error("Could not allocate a unique key id");
}

/** State for one provider, creating it if needed. */
function stateFor(vault, name) {
  if (!vault.providers[name]) vault.providers[name] = { active: null, keys: [] };
  const st = vault.providers[name];
  if (!Array.isArray(st.keys)) st.keys = [];
  return st;
}

/**
 * Resolve a user reference to a stored key.
 * Accepts: exact id, exact label (case-insensitive), 1-based index, or the key itself.
 */
function resolveRef(keys, ref) {
  if (!keys.length) throw new Error("No keys stored for this provider");

  const text = String(ref ?? "").trim();
  if (!text) throw new Error("Missing key reference (id, label or number)");

  const byId = keys.findIndex((k) => k.id.toLowerCase() === text.toLowerCase());
  if (byId !== -1) return byId;

  const byLabel = keys.findIndex((k) => String(k.label ?? "").toLowerCase() === text.toLowerCase());
  if (byLabel !== -1) return byLabel;

  if (/^\d+$/.test(text)) {
    const idx = Number(text) - 1;
    if (idx >= 0 && idx < keys.length) return idx;
  }

  const byValue = keys.findIndex((k) => k.key === text);
  if (byValue !== -1) return byValue;

  const known = keys.map((k, i) => `#${i + 1} ${k.id}${k.label ? ` (${k.label})` : ""}`).join(", ");
  throw new Error(`No stored key matches "${text}". Known: ${known}`);
}

module.exports = {
  defaultVaultPath,
  resolveVaultPath,
  loadVault,
  saveVault,
  stateFor,
  resolveRef,
  newId,
  now,
  emptyVault,
};
