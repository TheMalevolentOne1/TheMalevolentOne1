#!/usr/bin/env node
/**
 * Generates Monkeytype stats SVGs (dark + light) for a GitHub profile README.
 * Uses the public profile endpoint – no ApeKey required for basic stats.
 */

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../.."); // repo root when run from .github/scripts
const ASSETS = join(ROOT, "assets");

const USERNAME = process.env.MONKEYTYPE_USERNAME || "TheMalevolentOne";
const APE_KEY = process.env.MONKEYTYPE_APE_KEY || "";

const FONT = "Segoe UI, Ubuntu, Sans-Serif";

const THEMES = {
  dark: {
    bg: "#0d1117",
    border: "#30363d",
    title: "#e6edf3",
    subtitle: "#8b949e",
    label: "#8b949e",
    value: "#56FF5A",
    accent: "#3fb950",
    muted: "#484f58",
    card: "#161b22",
  },
  light: {
    bg: "#ffffff",
    border: "#d0d7de",
    title: "#1f2328",
    subtitle: "#656d76",
    label: "#656d76",
    value: "#0969da",
    accent: "#1a7f37",
    muted: "#afb8c1",
    card: "#f6f8fa",
  },
};

const LAYOUT = {
  height: 180,
  pad: 24, // outer padding, left / right

  // Header
  logoY: 14,
  logoSize: 22,
  titleX: 52, // logo right edge (46) + 6
  titleY: 32,
  subtitleY: 50,
  dividerY: 60,

  // Personal-best grid: `cols` columns, one row per entry in `rowLabelY`
  cols: 4,
  cellW: 60,
  cellGap: 8,
  rowLabelY: [79, 129], // baseline of the small label (15s, 10ws, …) in each row
  valueDy: 23, // label baseline → big number baseline
  accDy: 37, // label baseline → accuracy baseline

  // Summary column (TESTS / TIME) to the right of the grid
  summaryGap: 12,
  summaryW: 80,
};

/** [label shown on the card, key in the API's personal bests] – laid out row by row. */
const CELL_MODES = [
  ["15s", "15"],
  ["30s", "30"],
  ["60s", "60"],
  ["120s", "120"],
  ["10ws", "10"],
  ["25ws", "25"],
  ["50ws", "50"],
  ["100ws", "100"],
];

function formatTime(seconds) {
  if (!seconds || seconds <= 0) return "0m";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function bestPb(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  // Prefer highest wpm; if tie, higher accuracy
  return entries.reduce((best, cur) => {
    if (!best) return cur;
    if (cur.wpm > best.wpm) return cur;
    if (cur.wpm === best.wpm && cur.acc > best.acc) return cur;
    return best;
  }, null);
}

async function fetchProfile(username) {
  const url = `https://api.monkeytype.com/users/${encodeURIComponent(username)}/profile`;
  const headers = { Accept: "application/json" };
  if (APE_KEY) headers.Authorization = `ApeKey ${APE_KEY}`;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Monkeytype API ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  if (!json.data) throw new Error("Unexpected API response shape");
  return json.data;
}

function loadLogo(file, mime) {
  const buf = readFileSync(join(ASSETS, file));
  return `data:${mime};base64,${buf.toString("base64")}`;
}

const LOGOS = {
  dark: loadLogo("monkeytype_logo_dark.png", "image/png"),
  light: loadLogo("monkeytype_logo_light.svg", "image/svg+xml"),
};

/** Reduces the API profile to the numbers the card shows. */
function extractStats(data) {
  const pb = data.personalBests?.time || {};
  const stats = data.typingStats || {};

  const modes = ["15", "30", "60", "120", "10", "25", "50", "100"];
  const results = {};
  for (const mode of modes) {
    const best = bestPb(pb[mode]);
    results[mode] = best
      ? { wpm: Math.round(best.wpm), acc: Math.round(best.acc) }
      : { wpm: null, acc: null };
  }

  return {
    name: data.name || USERNAME,
    completed: stats.completedTests ?? 0,
    timeTyping: formatTime(stats.timeTyping ?? 0),
    ...results,
  };
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** One <text> element. `anchor` is "middle" for centred text, "start" for left-aligned. */
function svgText({ x, y, fill, size, weight, anchor = "middle" }, content) {
  const weightAttr = weight ? ` font-weight="${weight}"` : "";
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" fill="${fill}" font-size="${size}"${weightAttr} font-family="${FONT}">${escapeXml(content)}</text>`;
}

function renderSvg(stats, themeName) {
  const t = THEMES[themeName];
  const L = LAYOUT;

  // Derived geometry
  const gridRight = L.pad + L.cols * L.cellW + (L.cols - 1) * L.cellGap;
  const summaryX = gridRight + L.summaryGap + L.summaryW / 2; // centre of summary column
  const w = gridRight + L.summaryGap + L.summaryW + L.pad;
  const h = L.height;

  // Personal-best grid: label on top, WPM in the middle, accuracy underneath.
  // Every text in a cell shares the same centre x, and every cell in a row
  // shares the same baselines.
  const cellsSvg = CELL_MODES.map(([label, mode], i) => {
    const { wpm, acc } = stats[mode];
    const x = L.pad + (i % L.cols) * (L.cellW + L.cellGap) + L.cellW / 2;
    const labelY = L.rowLabelY[Math.floor(i / L.cols)];
    const wpmStr = wpm != null ? String(wpm) : "—";
    const accStr = acc != null ? `${acc}%` : "—";

    return [
      svgText({ x, y: labelY, fill: t.label, size: 12 }, label),
      svgText({ x, y: labelY + L.valueDy, fill: t.value, size: 28, weight: 700 }, wpmStr),
      svgText({ x, y: labelY + L.accDy, fill: t.subtitle, size: 13 }, `${accStr} acc`),
    ].join("\n  ");
  }).join("\n\n  ");

  // Right side summary: reuses the grid's row baselines so it lines up with it.
  const [topY, bottomY] = L.rowLabelY;
  const summary = [
    svgText({ x: summaryX, y: topY, fill: t.label, size: 11 }, "TESTS"),
    svgText({ x: summaryX, y: topY + L.valueDy, fill: t.accent, size: 20, weight: 600 }, stats.completed),
    svgText({ x: summaryX, y: bottomY, fill: t.label, size: 11 }, "TIME"),
    svgText({ x: summaryX, y: bottomY + L.valueDy, fill: t.accent, size: 16, weight: 600 }, stats.timeTyping),
  ].join("\n  ");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Monkeytype stats for ${escapeXml(stats.name)}">
  <title>Monkeytype stats – ${escapeXml(stats.name)}</title>
  <rect width="${w}" height="${h}" rx="8" fill="${t.bg}" stroke="${t.border}" stroke-width="1"/>

  <!-- header -->
  <image href="${LOGOS[themeName]}" x="${L.pad}" y="${L.logoY}" width="${L.logoSize}" height="${L.logoSize}" preserveAspectRatio="xMidYMid meet"/>
  ${svgText({ x: L.titleX, y: L.titleY, fill: t.title, size: 16, weight: 600, anchor: "start" }, "Monkeytype")}
  ${svgText({ x: L.pad, y: L.subtitleY, fill: t.subtitle, size: 12, anchor: "start" }, `${stats.name} · personal bests`)}

  <!-- divider -->
  <line x1="${L.pad}" y1="${L.dividerY}" x2="${w - L.pad}" y2="${L.dividerY}" stroke="${t.border}" stroke-width="1"/>

  <!-- typing statistics -->
  ${cellsSvg}

  <!-- right side summary -->
  ${summary}
</svg>`;
}

async function main() {
  console.log(`Fetching Monkeytype profile for ${USERNAME}…`);
  const data = await fetchProfile(USERNAME);
  const stats = extractStats(data);
  console.log("Stats:", JSON.stringify(stats, null, 2));

  mkdirSync(ASSETS, { recursive: true });

  for (const theme of ["dark", "light"]) {
    const svg = renderSvg(stats, theme);
    const out = join(ASSETS, `monkeytype-${theme}.svg`);
    writeFileSync(out, svg, "utf8");
    console.log(`Wrote ${out}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
