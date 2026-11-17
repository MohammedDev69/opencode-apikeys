"use strict";

/**
 * Minimal JSONC support: comments and trailing commas.
 * Strips them while respecting string literals and escapes, so that URLs
 * such as "https://..." are never mistaken for comments.
 */
function stripJsonc(text) {
  let out = "";
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inLineComment) {
      if (ch === "\n") {
        inLineComment = false;
        out += ch;
      }
      continue;
    }

    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }

    if (ch === "/" && next === "/") {
      inLineComment = true;
      i++;
      continue;
    }

    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }

    out += ch;
  }

  // Remove trailing commas before } or ]
  return out.replace(/,(\s*[}\]])/g, "$1");
}

function parseJsonc(text) {
  return JSON.parse(stripJsonc(text));
}

module.exports = { stripJsonc, parseJsonc };
