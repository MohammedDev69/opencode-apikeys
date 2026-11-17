#!/usr/bin/env node
"use strict";

const { findConfig, loadConfig, listProviders, shortPath } = require("../lib/config");
const { readKey, writeKey, deleteKey, backup, validateKey, mask } = require("../lib/store");
const vaultLib = require("../lib/vault");
const ui = require("../lib/ui");
const { color } = ui;

const pkg = require("../package.json");

const HELP = `
${color.bold("apikeys")} — manage OpenCode provider API keys

${color.bold("USAGE")}
  apikeys <command> [provider] [key-or-ref] [options]

${color.bold("COMMANDS")}
  ${color.cyan("list")}, ls                 Providers, active key and how many are stored
  ${color.cyan("keys")} [provider]          Every stored key, with ids and labels
  ${color.cyan("add")} <provider> [key]     Store a key without deleting the others
  ${color.cyan("use")} <provider> <ref>     Activate a stored key (id, label or number)
  ${color.cyan("set")} <provider> [key]     Store a key and make it active
  ${color.cyan("remove")}, rm <provider> <ref>
                                        Delete one stored key
  ${color.cyan("delete")} <provider>        Delete the whole store for a provider
  ${color.cyan("get")} <provider>           Show the active key (masked)
  ${color.cyan("test")} <provider> [ref]    Verify a key against the provider API
  ${color.cyan("path")} <provider>          Print the active key file path
  ${color.cyan("vault")}                    Print the vault file path
  ${color.cyan("help")} [command]           Show help (overall, or for one command)
  ${color.cyan("providers")}                Provider names only

${color.bold("OPTIONS")}
  -c, --config <path>     Use a specific opencode config file
  -l, --label <name>      Label for a key (add/set)
  -a, --activate          Activate the key right after adding it
      --all               Test every stored key (test only)
  -r, --reveal            Show the full key (get only)
  -y, --yes               Skip confirmations
  -j, --json              Machine-readable output
      --timeout <ms>      Network timeout for test (default 15000)
  -h, --help              Show this help
  -v, --version           Show version

${color.bold("EXAMPLES")}
  apikeys list
  apikeys keys vyce
  apikeys add vyce sk-da38c285... --label backup
  apikeys use vyce backup
  apikeys test vyce --all
  apikeys set numes sk-numes-v1-xxxx
  apikeys remove vyce 2 --yes

${ui.note("Keys live in the vault; the active one is mirrored to the {file:...} path")}
${ui.note("that your OpenCode config reads.")}

${color.bold("MORE HELP")}
  apikeys help <command>   Detailed help for one command (e.g. apikeys help use)
`;

const COMMAND_HELP = {
  list: `apikeys list [--json]

Show every provider with its status, active key (masked), number of stored
keys, model count and key file. Read-only.

Options: -j/--json
Example:  apikeys list`,

  keys: `apikeys keys [provider] [--json]

List the stored keys of one provider, or of all file-backed providers when no
name is given. The active key is marked with *.

Example:  apikeys keys vyce`,

  add: `apikeys add <provider> [key] [--label <name>] [--activate]

Store an extra key without deleting the others. The active key is unchanged
unless --activate is given, or unless the provider had no key yet.

Without a [key] argument the key is read from a hidden prompt, so it never
lands in your shell history.

Options: -l/--label, -a/--activate, -j/--json
Examples: apikeys add vyce sk-da38c285... --label backup
          echo sk-xxxx | apikeys add vyce --label ci`,

  use: `apikeys use <provider> <ref>

Activate a stored key: it is written into the provider's key file (after
backing up the previous one) and marked active in the vault.

<ref> = key id (7af0) | label (backup) | 1-based number (2)

Example:  apikeys use vyce backup`,

  set: `apikeys set <provider> [key] [--label <name>]

Store a key and make it active in one step. If the key is already stored it is
simply activated. Same as: add --activate.

Example:  apikeys set numes sk-numes-v1-xxxx`,

  remove: `apikeys remove <provider> <ref> [--yes]

Delete ONE stored key. If it was the active key, the next stored key becomes
active automatically. Removing the last key removes the key file too (a backup
is kept).

<ref> = key id | label | 1-based number

Options: -y/--yes
Example:  apikeys remove vyce 1 --yes`,

  delete: `apikeys delete <provider> [--yes]

Delete the ENTIRE store of a provider: every stored key plus the key file.
A timestamped backup of the key file is kept. Asks for confirmation.

Options: -y/--yes
Example:  apikeys delete tokenlab`,

  get: `apikeys get <provider> [--reveal] [--json]

Print the active key. Masked by default (sk-da38c…3352); --reveal prints the
full value.

Example:  apikeys get vyce --reveal`,

  test: `apikeys test <provider> [ref] [--all] [--timeout <ms>]

Call GET {baseURL}/models with the key and report whether it authenticates.
Never spends tokens on completions.

  (no ref)  test the active key
  <ref>     test one stored key
  --all     test every stored key

Example:  apikeys test vyce --all`,

  path: `apikeys path <provider>

Print the absolute path of the provider's active key file.

Example:  apikeys path vyce`,

  vault: `apikeys vault [--json]

Print the path of the vault file holding all stored keys.

Example:  apikeys vault`,

  providers: `apikeys providers [--json]

Print provider names only (useful for scripts).

Example:  apikeys providers`,
};

function fail(msg, code = 1) {
  console.error(ui.fail(msg));
  return code;
}

function parseArgs(argv) {
  const opts = {
    config: null,
    label: null,
    activate: false,
    all: false,
    reveal: false,
    yes: false,
    json: false,
    help: false,
    version: false,
    timeout: 15000,
  };
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (a === "-h" || a === "--help") { opts.help = true; continue; }
    if (a === "-v" || a === "--version") { opts.version = true; continue; }
    if (a === "-r" || a === "--reveal") { opts.reveal = true; continue; }
    if (a === "-y" || a === "--yes") { opts.yes = true; continue; }
    if (a === "-j" || a === "--json") { opts.json = true; continue; }
    if (a === "-a" || a === "--activate") { opts.activate = true; continue; }
    if (a === "--all") { opts.all = true; continue; }
    if (a === "-c" || a === "--config") { opts.config = argv[++i]; continue; }
    if (a.startsWith("--config=")) { opts.config = a.slice("--config=".length); continue; }
    if (a === "-l" || a === "--label") { opts.label = argv[++i]; continue; }
    if (a.startsWith("--label=")) { opts.label = a.slice("--label=".length); continue; }
    if (a === "--timeout") { opts.timeout = Number(argv[++i]); continue; }
    if (a.startsWith("--timeout=")) { opts.timeout = Number(a.slice("--timeout=".length)); continue; }
    if (a.startsWith("-") && a !== "-") throw new Error(`Unknown option: ${a}`);
    positional.push(a);
  }

  return { opts, positional };
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function statusOf(entry) {
  const kind = entry.key.kind;

  if (kind === "file") {
    const { exists, value } = readKey(entry.key.path);
    if (!exists) return { status: "missing", masked: "", value: "" };
    if (!value) return { status: "empty", masked: "", value: "" };
    return { status: "ok", masked: mask(value), value };
  }

  if (kind === "env") {
    const value = process.env[entry.key.env] ?? "";
    return { status: value ? "env" : "env-unset", masked: value ? mask(value) : "", value };
  }

  if (kind === "literal") return { status: "inline", masked: mask(entry.key.raw), value: entry.key.raw };
  if (kind === "template") return { status: "template", masked: entry.key.raw, value: "" };
  return { status: "none", masked: "", value: "" };
}

function paintStatus(status) {
  switch (status) {
    case "ok": return color.green("ok");
    case "missing": return color.red("missing");
    case "empty": return color.red("empty");
    case "env": return color.yellow("env");
    case "env-unset": return color.yellow("env-unset");
    case "inline": return color.yellow("inline");
    case "template": return color.yellow("template");
    default: return color.gray("none");
  }
}

function resolveProvider(entries, name) {
  if (!name) throw new Error("Missing provider name");
  const exact = entries.find((e) => e.name === name);
  if (exact) return exact;
  const ci = entries.find((e) => e.name.toLowerCase() === name.toLowerCase());
  if (ci) return ci;
  const names = entries.map((e) => e.name).join(", ");
  throw new Error(`Unknown provider "${name}". Available: ${names || "(none)"}`);
}

function requireFileStore(entry) {
  if (entry.key.kind === "file") return null;

  if (entry.key.kind === "env") {
    return (
      `"${entry.name}" reads its key from the environment variable ${entry.key.env}.\n` +
      `  Set it in your shell instead, e.g.  $env:${entry.key.env}="..."\n` +
      `  (or change the provider to use {file:~/.config/opencode/${entry.name}.key})`
    );
  }
  if (entry.key.kind === "literal") {
    return (
      `"${entry.name}" stores its key inline in the config file.\n` +
      `  Move it to {file:~/.config/opencode/${entry.name}.key} to manage it with this tool.`
    );
  }
  return `"${entry.name}" has no apiKey entry in the config. Add one first.`;
}

/** Read-only view: vault keys plus the key currently in the key file. */
function peekState(vault, entry) {
  const st = vault.providers[entry.name];
  const keys = st && Array.isArray(st.keys) ? st.keys.slice() : [];
  let active = (st && st.active) || null;

  if (entry.key.kind === "file") {
    const { value } = readKey(entry.key.path);
    if (value) {
      const idx = keys.findIndex((k) => k.key === value);
      if (idx === -1) {
        keys.push({ id: "file", label: "current file", key: value, added: null, virtual: true });
        if (!active) active = "file";
      } else if (!active) {
        active = keys[idx].id;
      }
    }
  }

  return { keys, active };
}

/** Mutating view: imports the key file into the vault on first use. */
function ensureState(vault, entry) {
  const st = vaultLib.stateFor(vault, entry.name);

  if (entry.key.kind === "file") {
    const { value } = readKey(entry.key.path);
    if (value && !st.keys.some((k) => k.key === value)) {
      const id = vaultLib.newId(st.keys);
      st.keys.push({
        id,
        label: st.keys.length ? `imported-${st.keys.length + 1}` : "imported",
        key: value,
        added: vaultLib.now(),
      });
      if (!st.active) st.active = id;
    }
  }

  return st;
}

function keyById(st, id) {
  return st.keys.find((k) => k.id === id) || null;
}

/** Writes a stored key into the provider's key file and marks it active. */
function activateKey(entry, st, target, vaultPath, vault) {
  const previous = readKey(entry.key.path);
  const saved = previous.exists ? backup(entry.key.path) : null;
  writeKey(entry.key.path, target.key);
  st.active = target.id;
  vaultLib.saveVault(vaultPath, vault);
  return saved;
}

/* ------------------------------------------------------------------ */
/* commands                                                            */
/* ------------------------------------------------------------------ */

function commandList(entries, configPath, vault, opts) {
  const rows = entries.map((e) => {
    const st = statusOf(e);
    const peek = peekState(vault, e);
    const activeKey = peek.keys.find((k) => k.id === peek.active) || null;
    const activeMasked = activeKey ? mask(activeKey.key) : st.masked;
    const file = e.key.kind === "file" ? shortPath(e.key.path) : e.key.kind === "env" ? `{env:${e.key.env}}` : "-";

    return {
      entry: e,
      name: e.name + (e.disabled ? color.dim(" (disabled)") : ""),
      status: paintStatus(st.status),
      active: activeMasked ? color.gray(activeMasked) : color.gray("-"),
      stored: String(peek.keys.length),
      models: String(e.models),
      file: color.gray(file),
      raw: { status: st.status, active: activeMasked, stored: peek.keys.length, activeId: peek.active },
    };
  });

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          config: shortPath(configPath),
          vault: shortPath(vaultLib.resolveVaultPath()),
          providers: rows.map((r) => ({
            name: r.entry.name,
            baseURL: r.entry.baseURL,
            models: r.entry.models,
            disabled: r.entry.disabled,
            keyKind: r.entry.key.kind,
            keyFile: r.entry.key.kind === "file" ? shortPath(r.entry.key.path) : null,
            envVar: r.entry.key.kind === "env" ? r.entry.key.env : null,
            status: r.raw.status,
            activeKeyId: r.raw.activeId,
            activeMasked: r.raw.active,
            storedKeys: r.raw.stored,
          })),
        },
        null,
        2
      )
    );
    return 0;
  }

  console.log(`${color.bold("OpenCode provider keys")}  ${color.dim(shortPath(configPath))}`);
  console.log("");
  console.log(
    ui.table(
      ["PROVIDER", "STATUS", "ACTIVE KEY", "STORED", "MODELS", "FILE"],
      rows.map((r) => [r.name, r.status, r.active, r.stored, r.models, r.file])
    )
  );
  console.log("");
  console.log(ui.note(`Vault: ${shortPath(vaultLib.resolveVaultPath())}`));

  const broken = rows.filter((r) => ["missing", "empty", "env-unset"].includes(r.raw.status));
  if (broken.length) {
    console.log(ui.warn(`${broken.length} provider(s) without a usable key: ${broken.map((b) => b.entry.name).join(", ")}`));
  }
  return 0;
}

function renderKeys(entry, peek, opts) {
  if (opts.json) {
    return {
      provider: entry.name,
      active: peek.active,
      keys: peek.keys.map((k, i) => ({
        index: i + 1,
        id: k.id,
        label: k.label ?? null,
        masked: mask(k.key),
        added: k.added ?? null,
        active: k.id === peek.active,
      })),
    };
  }

  if (!peek.keys.length) {
    console.log(ui.note(`${entry.name}: no keys stored`));
    return;
  }

  const rows = peek.keys.map((k, i) => {
    const isActive = k.id === peek.active;
    return [
      isActive ? color.green("*") : " ",
      String(i + 1),
      k.id,
      k.label ?? "",
      color.gray(mask(k.key)),
      k.added ? k.added.slice(0, 10) : "—",
    ];
  });

  console.log(`${color.bold(entry.name)} ${ui.note(`— ${peek.keys.length} key(s), active: ${peek.active ?? "none"}`)}`);
  console.log(ui.table([" ", "#", "ID", "LABEL", "KEY", "ADDED"], rows));
}

function commandKeys(entries, name, vault, opts) {
  const targets = name ? [resolveProvider(entries, name)] : entries.filter((e) => e.key.kind === "file");

  if (opts.json) {
    if (name) {
      const entry = targets[0];
      console.log(JSON.stringify(renderKeys(entry, peekState(vault, entry), opts), null, 2));
    } else {
      const payload = targets.map((e) => renderKeys(e, peekState(vault, e), opts));
      console.log(JSON.stringify({ vault: shortPath(vaultLib.resolveVaultPath()), providers: payload }, null, 2));
    }
    return 0;
  }

  targets.forEach((e, i) => {
    if (i) console.log("");
    renderKeys(e, peekState(vault, e), opts);
  });
  console.log("");
  console.log(ui.note(`Vault: ${shortPath(vaultLib.resolveVaultPath())}`));
  return 0;
}

function commandGet(entries, name, vault, opts) {
  const entry = resolveProvider(entries, name);
  const peek = peekState(vault, entry);
  const active = peek.keys.find((k) => k.id === peek.active) || null;

  if (!active) {
    return fail(`No key stored for "${entry.name}"`);
  }

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          name: entry.name,
          keyKind: entry.key.kind,
          keyFile: entry.key.kind === "file" ? shortPath(entry.key.path) : null,
          activeKeyId: active.id,
          label: active.label ?? null,
          key: opts.reveal ? active.key : mask(active.key),
        },
        null,
        2
      )
    );
    return 0;
  }

  if (opts.reveal) {
    console.log(active.key);
  } else {
    console.log(`${color.bold(entry.name)}  ${mask(active.key)}${active.label ? color.dim(`  (${active.label})`) : ""}`);
    console.log(ui.note("Use --reveal to print the full key."));
  }
  return 0;
}

async function commandSet(entries, name, inlineKey, vault, vaultPath, opts) {
  const entry = resolveProvider(entries, name);
  const blocked = requireFileStore(entry);
  if (blocked) return fail(blocked);

  let input = inlineKey;
  if (input === undefined) input = await ui.promptHidden(`New API key for ${color.bold(entry.name)}: `);

  const check = validateKey(input);
  if (!check.ok) return fail(`Invalid key: ${check.reason}`);

  const st = ensureState(vault, entry);

  let target = st.keys.find((k) => k.key === check.value);
  let added = false;

  if (!target) {
    target = {
      id: vaultLib.newId(st.keys),
      label: opts.label || (st.keys.length ? `key-${st.keys.length + 1}` : "primary"),
      key: check.value,
      added: vaultLib.now(),
    };
    st.keys.push(target);
    added = true;
  }

  const saved = activateKey(entry, st, target, vaultPath, vault);

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          provider: entry.name,
          activeKeyId: target.id,
          label: target.label ?? null,
          masked: mask(target.key),
          added,
          storedKeys: st.keys.length,
          backup: saved ? shortPath(saved) : null,
        },
        null,
        2
      )
    );
    return 0;
  }

  const verb = added ? "Added and activated" : "Activated existing";
  console.log(ui.ok(`${verb} key for ${color.bold(entry.name)}: ${mask(target.key)}${target.label ? color.dim(` (${target.label})`) : ""}`));
  console.log(ui.note(`Stored keys: ${st.keys.length} · active id: ${target.id}`));
  if (saved) console.log(ui.note(`Previous key file backed up to: ${shortPath(saved)}`));
  return 0;
}

async function commandAdd(entries, name, inlineKey, vault, vaultPath, opts) {
  const entry = resolveProvider(entries, name);
  const blocked = requireFileStore(entry);
  if (blocked) return fail(blocked);

  let input = inlineKey;
  if (input === undefined) input = await ui.promptHidden(`API key to store for ${color.bold(entry.name)}: `);

  const check = validateKey(input);
  if (!check.ok) return fail(`Invalid key: ${check.reason}`);

  const st = ensureState(vault, entry);
  const existing = st.keys.find((k) => k.key === check.value);

  if (existing) {
    if (opts.activate) {
      const saved = activateKey(entry, st, existing, vaultPath, vault);
      console.log(ui.ok(`Key already stored — activated ${mask(existing.key)}${existing.label ? color.dim(` (${existing.label})`) : ""}`));
      if (saved) console.log(ui.note(`Previous key file backed up to: ${shortPath(saved)}`));
    } else {
      console.log(ui.warn(`Key already stored as ${existing.id}${existing.label ? ` (${existing.label})` : ""} — nothing changed.`));
      console.log(ui.note("Use --activate or 'apikeys use' to make it active."));
    }
    return 0;
  }

  const target = {
    id: vaultLib.newId(st.keys),
    label: opts.label || `key-${st.keys.length + 1}`,
    key: check.value,
    added: vaultLib.now(),
  };
  st.keys.push(target);

  const wasEmpty = !st.active;
  let saved = null;
  if (opts.activate || wasEmpty) saved = activateKey(entry, st, target, vaultPath, vault);
  else vaultLib.saveVault(vaultPath, vault);

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          provider: entry.name,
          id: target.id,
          label: target.label,
          masked: mask(target.key),
          active: st.active === target.id,
          storedKeys: st.keys.length,
          backup: saved ? shortPath(saved) : null,
        },
        null,
        2
      )
    );
    return 0;
  }

  console.log(ui.ok(`Stored key ${target.id} for ${color.bold(entry.name)}: ${mask(target.key)}${color.dim(` (${target.label})`)}`));
  if (st.active === target.id) console.log(ui.note("It is now the active key."));
  else console.log(ui.note(`Stored only. Active key unchanged (${st.active}). Use 'apikeys use ${entry.name} ${target.id}' to switch.`));
  return 0;
}

async function commandUse(entries, name, ref, vault, vaultPath, opts) {
  const entry = resolveProvider(entries, name);
  const blocked = requireFileStore(entry);
  if (blocked) return fail(blocked);

  const st = ensureState(vault, entry);
  const idx = vaultLib.resolveRef(st.keys, ref);
  const target = st.keys[idx];
  const saved = activateKey(entry, st, target, vaultPath, vault);

  if (opts.json) {
    console.log(JSON.stringify({ provider: entry.name, activeKeyId: target.id, label: target.label ?? null, masked: mask(target.key), backup: saved ? shortPath(saved) : null }, null, 2));
    return 0;
  }

  console.log(ui.ok(`Activated ${target.id} for ${color.bold(entry.name)}: ${mask(target.key)}${target.label ? color.dim(` (${target.label})`) : ""}`));
  if (saved) console.log(ui.note(`Previous key file backed up to: ${shortPath(saved)}`));
  return 0;
}

async function commandRemove(entries, name, ref, vault, vaultPath, opts) {
  const entry = resolveProvider(entries, name);
  const blocked = requireFileStore(entry);
  if (blocked) return fail(blocked);

  const st = ensureState(vault, entry);
  const idx = vaultLib.resolveRef(st.keys, ref);
  const target = st.keys[idx];
  const wasActive = st.active === target.id;

  if (!opts.yes) {
    const confirmed = await ui.confirm(
      `Remove stored key ${target.id}${target.label ? ` (${target.label})` : ""} ${color.gray(mask(target.key))}${wasActive ? " — it is the ACTIVE key" : ""}?`,
      false
    );
    if (!confirmed) {
      console.log(ui.warn("Cancelled."));
      return 1;
    }
  }

  st.keys.splice(idx, 1);

  let switchedTo = null;
  if (wasActive) {
    if (st.keys.length) {
      const next = st.keys[0];
      activateKey(entry, st, next, vaultPath, vault);
      switchedTo = next;
    } else {
      st.active = null;
      const previous = readKey(entry.key.path);
      if (previous.exists) deleteKey(entry.key.path);
      delete vault.providers[entry.name];
      vaultLib.saveVault(vaultPath, vault);
    }
  } else {
    vaultLib.saveVault(vaultPath, vault);
  }

  if (opts.json) {
    console.log(JSON.stringify({ provider: entry.name, removed: target.id, switchedTo: switchedTo?.id ?? null, remaining: st.keys.length }, null, 2));
    return 0;
  }

  console.log(ui.ok(`Removed ${target.id} from ${color.bold(entry.name)}${target.label ? color.dim(` (${target.label})`) : ""}`));
  if (switchedTo) console.log(ui.note(`Active key switched to ${switchedTo.id} (${mask(switchedTo.key)}).`));
  if (!st.keys.length) console.log(ui.warn("No keys left for this provider; the key file was removed."));
  return 0;
}

async function commandDelete(entries, name, vault, vaultPath, opts) {
  const entry = resolveProvider(entries, name);
  const blocked = requireFileStore(entry);
  if (blocked) return fail(blocked);

  const st = ensureState(vault, entry);
  const total = st.keys.length;

  if (!opts.yes) {
    const confirmed = await ui.confirm(
      `Delete ALL ${total} stored key(s) for ${color.bold(entry.name)} and remove the key file? Backups are kept.`,
      false
    );
    if (!confirmed) {
      console.log(ui.warn("Cancelled."));
      return 1;
    }
  }

  const previous = readKey(entry.key.path);
  const saved = previous.exists ? deleteKey(entry.key.path) : null;
  delete vault.providers[entry.name];
  vaultLib.saveVault(vaultPath, vault);

  if (opts.json) {
    console.log(JSON.stringify({ provider: entry.name, deleted: true, keysRemoved: total, backup: saved ? shortPath(saved) : null }, null, 2));
    return 0;
  }

  console.log(ui.ok(`Deleted ${total} stored key(s) for ${color.bold(entry.name)}`));
  if (saved) console.log(ui.note(`Key file backed up to: ${shortPath(saved)}`));
  return 0;
}

async function probe(baseURL, keyValue, timeoutMs) {
  const url = baseURL.replace(/\/+$/, "") + "/models";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(timeoutMs) || 15000);
  const started = Date.now();

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${keyValue}`, Accept: "application/json" },
      signal: controller.signal,
    });
    const elapsed = Date.now() - started;
    const text = await res.text();
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {}
    const count = Array.isArray(parsed?.data) ? parsed.data.length : null;
    return {
      ok: res.status === 200 && count !== null,
      status: res.status,
      models: count,
      ms: elapsed,
      message: String(parsed?.error?.message ?? (count === null ? text : "") ?? "").replace(/\s+/g, " ").slice(0, 120),
    };
  } catch (e) {
    if (e.name === "AbortError") return { ok: false, timeout: true, ms: timeoutMs };
    return { ok: false, error: e.message };
  } finally {
    clearTimeout(timer);
  }
}

function describeProbe(result) {
  if (result.timeout) return `timed out after ${result.ms} ms`;
  if (result.error) return `request failed: ${result.error}`;
  if (result.ok) return `HTTP 200, ${result.models} models (${result.ms} ms)`;
  const hint = result.status === 401 || result.status === 403 ? " — the key was rejected" : result.status === 404 ? " — check the provider baseURL" : "";
  return `HTTP ${result.status}${hint}${result.message ? ": " + result.message : ""}`;
}

async function commandTest(entries, name, ref, vault, opts) {
  const entry = resolveProvider(entries, name);
  if (!entry.baseURL) return fail(`Provider "${entry.name}" has no baseURL in the config`);

  const peek = peekState(vault, entry);

  if (opts.all) {
    if (!peek.keys.length) return fail(`No keys stored for "${entry.name}"`);

    const results = [];
    for (const k of peek.keys) {
      const r = await probe(entry.baseURL, k.key, opts.timeout);
      results.push({ key: k, result: r });
    }

    if (opts.json) {
      console.log(JSON.stringify({ provider: entry.name, results: results.map((r) => ({ id: r.key.id, label: r.key.label ?? null, masked: mask(r.key.key), active: r.key.id === peek.active, ...r.result })) }, null, 2));
      return results.every((r) => r.result.ok) ? 0 : 1;
    }

    console.log(`${color.bold(entry.name)} ${ui.note(`— testing ${results.length} key(s)`)}`);
    for (const { key, result } of results) {
      const mark = result.ok ? color.green("✓") : color.red("✗");
      const star = key.id === peek.active ? color.green(" *") : "  ";
      console.log(`${mark}${star} ${key.id} ${color.gray(mask(key.key))} ${color.dim(key.label ?? "")} — ${describeProbe(result)}`);
    }
    return results.every((r) => r.result.ok) ? 0 : 1;
  }

  let target = null;
  if (ref) {
    const idx = vaultLib.resolveRef(peek.keys, ref);
    target = peek.keys[idx];
  } else {
    target = peek.keys.find((k) => k.id === peek.active) || null;
  }

  if (!target) return fail(`No key stored for "${entry.name}"`);

  const result = await probe(entry.baseURL, target.key, opts.timeout);

  if (opts.json) {
    console.log(JSON.stringify({ provider: entry.name, id: target.id, masked: mask(target.key), ...result }, null, 2));
    return result.ok ? 0 : 1;
  }

  const label = target.label ? color.dim(` (${target.label})`) : "";
  if (result.ok) {
    console.log(ui.ok(`${color.bold(entry.name)} key ${target.id}${label} works — ${describeProbe(result)}`));
    return 0;
  }
  console.error(ui.fail(`${color.bold(entry.name)} key ${target.id}${label} failed — ${describeProbe(result)}`));
  return 1;
}

function commandPath(entries, name, opts) {
  const entry = resolveProvider(entries, name);
  if (entry.key.kind !== "file") return fail(`"${entry.name}" has no key file (kind: ${entry.key.kind}).`);
  if (opts.json) console.log(JSON.stringify({ name: entry.name, file: entry.key.path, short: shortPath(entry.key.path) }, null, 2));
  else console.log(entry.key.path);
  return 0;
}

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */

async function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (e) {
    return fail(e.message + "\nRun 'apikeys --help' for usage.", 2);
  }

  const { opts, positional } = parsed;

  if (opts.version) {
    console.log(pkg.version);
    return 0;
  }

  const command = positional[0];
  if (opts.help || !command) {
    console.log(HELP.trimEnd());
    return 0;
  }

  if (command === "help" || command === "h" || command === "?") {
    const topic = positional[1];
    if (topic) {
      const text = COMMAND_HELP[topic.toLowerCase()];
      if (!text) return fail(`No detailed help for "${topic}". Run 'apikeys --help' for the command list.`, 2);
      console.log(text);
      return 0;
    }
    console.log(HELP.trimEnd());
    return 0;
  }

  const vaultPath = vaultLib.resolveVaultPath();
  let vault;
  try {
    vault = vaultLib.loadVault(vaultPath);
  } catch (e) {
    return fail(e.message);
  }

  if (command === "vault") {
    if (opts.json) console.log(JSON.stringify({ vault: vaultPath, short: shortPath(vaultPath) }, null, 2));
    else console.log(vaultPath);
    return 0;
  }

  let configPath;
  try {
    configPath = findConfig(opts.config);
  } catch (e) {
    return fail(e.message);
  }
  opts.configPath = configPath;

  let entries;
  try {
    entries = listProviders(loadConfig(configPath), configPath);
  } catch (e) {
    return fail(e.message);
  }

  const name = positional[1];
  const ref = positional[2];

  switch (command) {
    case "list":
    case "ls":
      return commandList(entries, configPath, vault, opts);
    case "keys":
    case "key":
      return commandKeys(entries, name, vault, opts);
    case "get":
    case "show":
      return commandGet(entries, name, vault, opts);
    case "set":
      return commandSet(entries, name, positional[2], vault, vaultPath, opts);
    case "add":
      return commandAdd(entries, name, positional[2], vault, vaultPath, opts);
    case "use":
    case "activate":
      return commandUse(entries, name, ref, vault, vaultPath, opts);
    case "remove":
    case "rm":
      return commandRemove(entries, name, ref, vault, vaultPath, opts);
    case "delete":
    case "del":
      return commandDelete(entries, name, vault, vaultPath, opts);
    case "test":
    case "check":
      return commandTest(entries, name, ref, vault, opts);
    case "path":
      return commandPath(entries, name, opts);
    case "providers":
      if (opts.json) console.log(JSON.stringify(entries.map((e) => e.name)));
      else entries.forEach((e) => console.log(e.name));
      return 0;
    default:
      return fail(`Unknown command: ${command}\nRun 'apikeys --help' for usage.`, 2);
  }
}

main()
  .then((code) => {
    process.exitCode = code ?? 0;
  })
  .catch((e) => {
    if (e.message === "cancelled") {
      console.error(ui.warn("Cancelled."));
      process.exitCode = 130;
      return;
    }
    console.error(ui.fail(e.message));
    process.exitCode = 1;
  });
