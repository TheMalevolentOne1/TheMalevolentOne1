#!/usr/bin/env node
/**
 * Generates Monkeytype stats SVGs (dark + light) for a GitHub profile README.
 * Uses the public profile endpoint – no ApeKey required for basic stats.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../.."); // repo root when run from .github/scripts
const ASSETS = join(ROOT, "assets");

const USERNAME = process.env.MONKEYTYPE_USERNAME || "TheMalevolentOne";
const APE_KEY = process.env.MONKEYTYPE_APE_KEY || "";

const THEMES = {
  dark: {
    bg: "#0d1117",
    border: "#30363d",
    title: "#e6edf3",
    subtitle: "#8b949e",
    label: "#8b949e",
    value: "#58a6ff",
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

function extractStats(data) {
  const pb = data.personalBests?.time || {};
  const stats = data.typingStats || {};

  const modes = ["15", "30", "60"];
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

function renderSvg(stats, themeName) {
  const t = THEMES[themeName];
  const w = 480;
  const h = 180;

  const cells = [
    { label: "15s", wpm: stats["15"].wpm, acc: stats["15"].acc },
    { label: "30s", wpm: stats["30"].wpm, acc: stats["30"].acc },
    { label: "60s", wpm: stats["60"].wpm, acc: stats["60"].acc },
  ];

  const cellW = 120;
  const startX = 30;
  const yWpm = 88;
  const yAcc = 118;
  const yLabel = 142;

  let cellsSvg = "";
  cells.forEach((c, i) => {
    const x = startX + i * (cellW + 20);
    const wpmStr = c.wpm != null ? String(c.wpm) : "—";
    const accStr = c.acc != null ? `${c.acc}%` : "—";
    cellsSvg += `
      <text x="${x + cellW / 2}" y="${yWpm}" text-anchor="middle" fill="${t.value}" font-size="28" font-weight="700" font-family="Segoe UI, Ubuntu, Sans-Serif">${escapeXml(wpmStr)}</text>
      <text x="${x + cellW / 2}" y="${yAcc}" text-anchor="middle" fill="${t.subtitle}" font-size="13" font-family="Segoe UI, Ubuntu, Sans-Serif">${escapeXml(accStr)} acc</text>
      <text x="${x + cellW / 2}" y="${yLabel}" text-anchor="middle" fill="${t.label}" font-size="12" font-family="Segoe UI, Ubuntu, Sans-Serif">${escapeXml(c.label)}</text>
    `;
  });

  // Right side summary
  const rightX = 415;
  const summary = `
    <text x="${rightX}" y="78" text-anchor="middle" fill="${t.label}" font-size="11" font-family="Segoe UI, Ubuntu, Sans-Serif">TESTS</text>
    <text x="${rightX}" y="100" text-anchor="middle" fill="${t.accent}" font-size="20" font-weight="600" font-family="Segoe UI, Ubuntu, Sans-Serif">${stats.completed}</text>
    <text x="${rightX}" y="128" text-anchor="middle" fill="${t.label}" font-size="11" font-family="Segoe UI, Ubuntu, Sans-Serif">TIME</text>
    <text x="${rightX}" y="148" text-anchor="middle" fill="${t.accent}" font-size="16" font-weight="600" font-family="Segoe UI, Ubuntu, Sans-Serif">${escapeXml(stats.timeTyping)}</text>
  `;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Monkeytype stats for ${escapeXml(stats.name)}">
  <title>Monkeytype stats – ${escapeXml(stats.name)}</title>
  <rect width="${w}" height="${h}" rx="8" fill="${t.bg}" stroke="${t.border}" stroke-width="1"/>
  <!-- header -->
  <text x="24" y="32" fill="${t.title}" font-size="16" font-weight="600" font-family="Segoe UI, Ubuntu, Sans-Serif">🐒 Monkeytype</text>
  <text x="24" y="50" fill="${t.subtitle}" font-size="12" font-family="Segoe UI, Ubuntu, Sans-Serif">${escapeXml(stats.name)} · personal bests</text>
  <!-- divider -->
  <line x1="24" y1="60" x2="${w - 24}" y2="60" stroke="${t.border}" stroke-width="1"/>
  ${cellsSvg}
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
