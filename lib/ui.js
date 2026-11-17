"use strict";

const readline = require("readline");

const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const wrap = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s));

const color = {
  bold: wrap("1"),
  dim: wrap("2"),
  red: wrap("31"),
  green: wrap("32"),
  yellow: wrap("33"),
  blue: wrap("34"),
  magenta: wrap("35"),
  cyan: wrap("36"),
  gray: wrap("90"),
};

const ANSI = /\x1b\[[0-9;]*m/g;
const visibleLength = (s) => String(s).replace(ANSI, "").length;

function table(headers, rows) {
  const widths = headers.map((h, i) =>
    Math.max(visibleLength(h), ...rows.map((r) => visibleLength(r[i] ?? "")))
  );

  const formatRow = (cells) =>
    cells
      .map((cell, i) => {
        const text = String(cell ?? "");
        return text + " ".repeat(Math.max(0, widths[i] - visibleLength(text)));
      })
      .join("  ")
      .replace(/\s+$/, "");

  const head = color.dim(formatRow(headers));
  const divider = color.gray("─".repeat(widths.reduce((a, w) => a + w + 2, -2)));
  const body = rows.map((r) => formatRow(r)).join("\n");
  return [head, divider, body].filter(Boolean).join("\n");
}

function rule() {
  return color.gray("─".repeat(46));
}

function ok(msg) {
  return `${color.green("✓")} ${msg}`;
}
function warn(msg) {
  return `${color.yellow("!")} ${msg}`;
}
function fail(msg) {
  return `${color.red("✗")} ${msg}`;
}
function info(msg) {
  return `${color.blue("·")} ${msg}`;
}
function note(msg) {
  return color.dim(msg);
}

/** Hidden input: prints asterisks, never echoes the key. */
function promptHidden(label) {
  if (!process.stdin.isTTY) {
    // Piped input: read one line without echoing anyway.
    return new Promise((resolve) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
      rl.once("line", (line) => {
        rl.close();
        resolve(line.trim());
      });
    });
  }

  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    let buffer = "";

    process.stdout.write(label);

    const cleanup = () => {
      stdin.removeListener("data", onData);
      try {
        stdin.setRawMode(false);
      } catch {}
      stdin.pause();
    };

    const onData = (chunk) => {
      const str = String(chunk);
      for (const ch of str) {
        if (ch === "\r" || ch === "\n" || ch === "\u0004") {
          cleanup();
          process.stdout.write("\n");
          resolve(buffer.trim());
          return;
        }
        if (ch === "\u0003") {
          cleanup();
          process.stdout.write("\n");
          reject(new Error("cancelled"));
          return;
        }
        if (ch === "\u007f" || ch === "\b") {
          if (buffer) {
            buffer = buffer.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }
        if (ch >= " ") {
          buffer += ch;
          process.stdout.write("*");
        }
      }
    };

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    stdin.on("data", onData);
  });
}

async function confirm(question, defaultYes = false) {
  if (!process.stdin.isTTY) return defaultYes;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const suffix = defaultYes ? " [Y/n] " : " [y/N] ";
  const answer = await new Promise((resolve) => rl.question(question + suffix, resolve));
  rl.close();
  const a = answer.trim().toLowerCase();
  if (!a) return defaultYes;
  return a === "y" || a === "yes";
}

module.exports = { color, table, rule, ok, warn, fail, info, note, promptHidden, confirm, visibleLength };
