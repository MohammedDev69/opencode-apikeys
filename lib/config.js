"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { parseJsonc } = require("./jsonc");

const HOME = os.homedir();

function expandHome(p) {
  if (!p) return p;
  if (p === "~") return HOME;
  if (p.startsWith("~/") || p.startsWith("~\\")) return path.join(HOME, p.slice(2));
  return p;
}

function shortPath(p) {
  if (!p) return "";
  const home = HOME.replace(/\\/g, "/");
  const norm = p.replace(/\\/g, "/");
  return norm.startsWith(home + "/") ? "~/" + norm.slice(home.length + 1) : norm;
}

/** Locate the OpenCode config file. */
function findConfig(explicit) {
  if (explicit) {
    const p = path.resolve(expandHome(explicit));
    if (!fs.existsSync(p)) {
      throw new Error(`Config file not found: ${p}`);
    }
    return p;
  }

  const dir = path.join(HOME, ".config", "opencode");
  const candidates = ["opencode.jsonc", "opencode.json", "config.jsonc", "config.json"];
  for (const name of candidates) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`No OpenCode config found in ${dir}`);
}

function loadConfig(configPath) {
  const text = fs.readFileSync(configPath, "utf8");
  try {
    return parseJsonc(text);
  } catch (e) {
    throw new Error(`Cannot parse ${shortPath(configPath)}: ${e.message}`);
  }
}

/**
 * Work out how a provider stores its API key.
 * Supports {file:...}, {env:VAR}, inline literals and other templates.
 */
function resolveKeySpec(provider, configPath) {
  const raw = provider?.settings?.apiKey ?? provider?.options?.apiKey ?? null;
  if (raw === null || raw === undefined) return { kind: "none" };

  const text = String(raw).trim();
  const fileMatch = /^\{file:(.+)\}$/.exec(text);
  if (fileMatch) {
    let p = fileMatch[1].trim();
    p = expandHome(p);
    if (!path.isAbsolute(p)) p = path.resolve(path.dirname(configPath), p);
    return { kind: "file", path: p, raw: text };
  }

  const envMatch = /^\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(text);
  if (envMatch) return { kind: "env", env: envMatch[1], raw: text };

  if (text.startsWith("{")) return { kind: "template", raw: text };

  return { kind: "literal", raw: text };
}

/** Normalised provider list, sorted by name. */
function listProviders(config, configPath) {
  const block = config.providers || config.provider || {};
  return Object.entries(block)
    .map(([name, p]) => ({
      name,
      baseURL: p?.settings?.baseURL ?? p?.options?.baseURL ?? null,
      models: Object.keys(p?.models ?? {}).length,
      key: resolveKeySpec(p, configPath),
      disabled: p?.disabled === true || p?.enabled === false,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = { HOME, expandHome, shortPath, findConfig, loadConfig, listProviders, resolveKeySpec };
