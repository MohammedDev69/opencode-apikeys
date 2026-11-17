# apikeys

A tiny CLI to manage the API keys of your **OpenCode** providers — keep several
keys per provider in a vault, choose which one is active, test them, and switch
between them from any directory and any shell.

No dependencies. Node.js 18+.

## Install

From GitHub:

```bash
npm install -g github:MohammedDev69/opencode-apikeys
```

From a local clone (development):

```bash
git clone https://github.com/MohammedDev69/opencode-apikeys.git
cd opencode-apikeys
npm link
```

Either way you get a global `apikeys` command that works from any directory in
any shell (`cmd.exe`, PowerShell, bash).

To remove it later:

```bash
npm unlink -g opencode-apikeys
```

## How it works

Two layers:

1. **The vault** — `~/.config/opencode/apikeys.vault.json` holds every stored key
   per provider, each with a short id, a label and an added date. Exactly one is
   marked active. File permissions are owner-only (0600).
2. **The key file** — OpenCode reads the provider's `{file:...}` path. The tool
   mirrors the *active* vault key into that file, so OpenCode always sees one key.

```
vault.json ──(active key)──> ~/.config/opencode/myprovider.key ──> OpenCode
```

If a provider has a key file but no vault entry yet, the tool imports it
automatically on the first mutating command (list is read-only and just shows it
as `current file`).

### Supported `apiKey` forms

| `apiKey` value | Meaning |
|---|---|
| `{file:~/path/to/x.key}` | Key stored in that file — fully manageable |
| `{env:VAR}` | Key comes from an environment variable — read-only |
| `"sk-literal..."` | Key inline in the config — reported, not edited |

## Commands

```text
apikeys list                  Providers, active key, number of stored keys
apikeys keys [provider]       Every stored key: id, label, masked value, date
apikeys add <provider> [key]  Store a key without touching the active one
apikeys use <provider> <ref>  Activate a stored key
apikeys set <provider> [key]  Store a key and activate it immediately
apikeys remove <provider> <ref>
                              Delete one stored key
apikeys delete <provider>     Delete the whole store and the key file
apikeys get <provider>        Show the active key (masked)
apikeys test <provider> [ref] Verify one key against the provider API
apikeys test <provider> --all Verify every stored key
apikeys path <provider>       Print the active key file path
apikeys vault                 Print the vault file path
apikeys help [command]        Overall help, or detailed help for one command
apikeys providers             Provider names only
```

A `<ref>` can be a key **id** (`7af0`), a **label** (`recovered`), or a
**1-based number** (`2`).

Options: `-c/--config <path>`, `-l/--label <name>`, `-a/--activate`, `--all`,
`-r/--reveal`, `-y/--yes`, `-j/--json`, `--timeout <ms>`, `-h/--help`,
`-v/--version`.

### Typical workflow

```bash
# see what is stored
apikeys keys myprovider

# add a spare key without disturbing the active one
apikeys add myprovider sk-spare-key --label backup

# add and switch in one step
apikeys add myprovider sk-new-key-here --label primary --activate

# switch later
apikeys use myprovider backup

# check that every key still authenticates
apikeys test myprovider --all

# remove one key (asks for confirmation; --yes to skip)
apikeys remove myprovider 1
```

## Safety behaviour

- **Never prints a full key** unless you pass `--reveal`.
- **Never overwrites anything silently**: every write to a key file first saves
  `<key>.bak-YYYYMMDD-HHmmss` (with a `-1`, `-2` suffix on collision).
- Writes are atomic (temp file + rename) with owner-only permissions.
- Removing the last key of a provider deletes the key file but keeps a backup.
- `remove` / `delete` ask for confirmation; non-interactive shells default to
  *cancel*.
- Keys are masked as `sk-ab12cd…9f8e` (first 8 + last 4 characters).

## Environment

| Variable | Purpose |
|---|---|
| `APIKEYS_VAULT` | Use a different vault file (handy for testing) |
| `NO_COLOR` | Disable ANSI colours |

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Failure (missing key, rejected key, unknown provider) |
| 2 | Usage error |
| 130 | Cancelled by the user |

## Restoring a key

Backups stay next to the key file:

```bash
cp ~/.config/opencode/myprovider.key.bak-20260101-120000 ~/.config/opencode/myprovider.key
```

## Notes

- `test` only proves the key authenticates (`GET {baseURL}/models`); it never
  spends tokens on completions.
- After switching keys, already-running OpenCode processes may keep the old key
  in memory. Config watchers usually reload, but a restart is the safe option.
