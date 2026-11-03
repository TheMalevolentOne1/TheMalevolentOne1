#!/usr/bin/env node
/**
 * Generates Monkeytype stats SVGs (dark + light) for a GitHub profile README.
 * Uses the public profile endpoint – no ApeKey required for basic stats.
 */

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
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
  },
  light: {
    bg: "#ffffff",
    border: "#d0d7de",
    title: "#1f2328",
    subtitle: "#656d76",
    label: "#656d76",
    value: "#0969da",
    accent: "#1a7f37",
  },
};

const LAYOUT = {
  height: 220,
  pad: 24,

  logoY: 14,
  logoSize: 22,
  titleX: 52,
  titleY: 32,
  subtitleY: 50,
  dividerY: 60,

  cols: 4,
  cellW: 60,
  cellGap: 8,
  rowLabelY: [79, 154],
  valueDy: 21,
  wordsDy: 39,
  accDy: 56,

  summaryGap: 12,
  summaryW: 80,
};

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

  return entries.reduce((best, current) => {
    if (!best) return current;
    if (current.wpm > best.wpm) return current;
    if (current.wpm === best.wpm && current.acc > best.acc) {
      return current;
    }
    return best;
  }, null);
}

async function fetchProfile(username) {
  const url = `https://api.monkeytype.com/users/${encodeURIComponent(username)}/profile`;
  const headers = { Accept: "application/json" };

  if (APE_KEY) {
    headers.Authorization = `ApeKey ${APE_KEY}`;
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Monkeytype API ${response.status}: ${body.slice(0, 200)}`,
    );
  }

  const json = await response.json();

  if (!json.data) {
    throw new Error("Unexpected API response shape");
  }

  return json.data;
}

function loadLogo(file, mime) {
  const buffer = readFileSync(join(ASSETS, file));
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

const LOGOS = {
  dark: loadLogo("monkeytype_logo_dark.png", "image/png"),
  light: loadLogo("monkeytype_logo_light.svg", "image/svg+xml"),
};

function extractStats(data) {
  const personalBests = data.personalBests?.time || {};
  const typingStats = data.typingStats || {};

  const modes = ["15", "30", "60", "120", "10", "25", "50", "100"];
  const results = {};

  for (const mode of modes) {
    const best = bestPb(personalBests[mode]);

    results[mode] = best
      ? {
          wpm: Math.round(best.wpm),

          // Timed modes: calculate words from WPM and duration.
          // Word modes: use the configured number of words.
          words: ["15", "30", "60", "120"].includes(mode)
            ? Math.round((best.wpm * Number(mode)) / 60)
            : Number(mode),

          acc: Math.round(best.acc),
        }
      : {
          wpm: null,
          words: null,
          acc: null,
        };
  }

  return {
    name: data.name || USERNAME,
    completed: typingStats.completedTests ?? 0,
    timeTyping: formatTime(typingStats.timeTyping ?? 0),
    ...results,
  };
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function svgText(
  { x, y, fill, size, weight, anchor = "middle" },
  content,
) {
  const weightAttribute = weight
    ? ` font-weight="${weight}"`
    : "";

  return `<text x="${x}" y="${y}" text-anchor="${anchor}" fill="${fill}" font-size="${size}"${weightAttribute} font-family="${FONT}">${escapeXml(content)}</text>`;
}

function renderSvg(stats, themeName) {
  const theme = THEMES[themeName];
  const layout = LAYOUT;

  const gridRight =
    layout.pad +
    layout.cols * layout.cellW +
    (layout.cols - 1) * layout.cellGap;

  const summaryX =
    gridRight +
    layout.summaryGap +
    layout.summaryW / 2;

  const width =
    gridRight +
    layout.summaryGap +
    layout.summaryW +
    layout.pad;

  const height = layout.height;

  const cellsSvg = CELL_MODES.map(([label, mode], index) => {
    const { wpm, words, acc } = stats[mode];

    const x =
      layout.pad +
      (index % layout.cols) * (layout.cellW + layout.cellGap) +
      layout.cellW / 2;

    const labelY =
      layout.rowLabelY[Math.floor(index / layout.cols)];

    const wpmText = wpm != null ? String(wpm) : "—";
    const wordsText = words != null ? `${words} words` : "—";
    const accuracyText = acc != null ? `${acc}%` : "—";

    return [
      svgText(
        { x, y: labelY, fill: theme.label, size: 12 },
        label,
      ),
      svgText(
        {
          x,
          y: labelY + layout.valueDy,
          fill: theme.value,
          size: 26,
          weight: 700,
        },
        wpmText,
      ),
      svgText(
        {
          x,
          y: labelY + layout.wordsDy,
          fill: theme.subtitle,
          size: 11,
        },
        wordsText,
      ),
      svgText(
        {
          x,
          y: labelY + layout.accDy,
          fill: theme.subtitle,
          size: 13,
        },
        `${accuracyText} acc`,
      ),
    ].join("\n  ");
  }).join("\n\n  ");

  const [topY, bottomY] = layout.rowLabelY;

  const summary = [
    svgText(
      { x: summaryX, y: topY, fill: theme.label, size: 11 },
      "TESTS",
    ),
    svgText(
      {
        x: summaryX,
        y: topY + layout.valueDy,
        fill: theme.accent,
        size: 20,
        weight: 600,
      },
      stats.completed,
    ),
    svgText(
      { x: summaryX, y: bottomY, fill: theme.label, size: 11 },
      "TIME",
    ),
    svgText(
      {
        x: summaryX,
        y: bottomY + layout.valueDy,
        fill: theme.accent,
        size: 16,
        weight: 600,
      },
      stats.timeTyping,
    ),
  ].join("\n  ");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Monkeytype stats for ${escapeXml(stats.name)}">
  <title>Monkeytype stats – ${escapeXml(stats.name)}</title>
  <rect width="${width}" height="${height}" rx="8" fill="${theme.bg}" stroke="${theme.border}" stroke-width="1"/>

  <image href="${LOGOS[themeName]}" x="${layout.pad}" y="${layout.logoY}" width="${layout.logoSize}" height="${layout.logoSize}" preserveAspectRatio="xMidYMid meet"/>

  ${svgText(
    {
      x: layout.titleX,
      y: layout.titleY,
      fill: theme.title,
      size: 16,
      weight: 600,
      anchor: "start",
    },
    "Monkeytype",
  )}

  ${svgText(
    {
      x: layout.pad,
      y: layout.subtitleY,
      fill: theme.subtitle,
      size: 12,
      anchor: "start",
    },
    `${stats.name} · personal bests`,
  )}

  <line x1="${layout.pad}" y1="${layout.dividerY}" x2="${width - layout.pad}" y2="${layout.dividerY}" stroke="${theme.border}" stroke-width="1"/>

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
    const output = join(ASSETS, `monkeytype-${theme}.svg`);

    writeFileSync(output, svg, "utf8");
    console.log(`Wrote ${output}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
