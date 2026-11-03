#!/usr/bin/env node

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

/*
 * id       = internal identifier
 * label    = text shown on the card
 * category = Monkeytype API category
 * mode     = Monkeytype API mode
 */
const CELL_MODES = [
  { id: "15s", label: "15s", category: "time", mode: "15" },
  { id: "30s", label: "30s", category: "time", mode: "30" },
  { id: "60s", label: "60s", category: "time", mode: "60" },
  { id: "120s", label: "120s", category: "time", mode: "120" },

  { id: "15ws", label: "15ws", category: "words", mode: "15" },
  { id: "25ws", label: "25ws", category: "words", mode: "25" },
  { id: "50ws", label: "50ws", category: "words", mode: "50" },
  { id: "100ws", label: "100ws", category: "words", mode: "100" },
];

function formatTime(seconds) {
  if (!seconds || seconds <= 0) return "0m";

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
}

function bestPb(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return null;
  }

  return entries.reduce((best, current) => {
    if (!best) return current;

    if (Number(current.wpm) > Number(best.wpm)) {
      return current;
    }

    if (
      Number(current.wpm) === Number(best.wpm) &&
      Number(current.acc) > Number(best.acc)
    ) {
      return current;
    }

    return best;
  }, null);
}

async function fetchProfile(username) {
  const url = `https://api.monkeytype.com/users/${encodeURIComponent(username)}/profile`;

  const headers = {
    Accept: "application/json",
  };

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
    throw new Error("Unexpected Monkeytype API response");
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
  const personalBests = data.personalBests || {};
  const timeBests = personalBests.time || {};
  const wordBests = personalBests.words || {};
  const typingStats = data.typingStats || {};

  const results = {};

  for (const cell of CELL_MODES) {
    const source =
      cell.category === "time"
        ? timeBests[cell.mode]
        : wordBests[cell.mode];

    const best = bestPb(source);

    if (!best) {
      results[cell.id] = {
        wpm: null,
        words: null,
        acc: null,
      };
      continue;
    }

    const wpm = Math.round(Number(best.wpm));

    const words =
      cell.category === "words"
        ? Number(cell.mode)
        : Math.round((Number(best.wpm) * Number(cell.mode)) / 60);

    results[cell.id] = {
      wpm,
      words,
      acc: Number(best.acc).toFixed(2),
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

  const cellsSvg = CELL_MODES.map((cell, index) => {
    const stat = stats[cell.id];

    const x =
      layout.pad +
      (index % layout.cols) * (layout.cellW + layout.cellGap) +
      layout.cellW / 2;

    const labelY =
      layout.rowLabelY[Math.floor(index / layout.cols)];

    const wpmText =
      stat.wpm != null ? `${stat.wpm} WPM` : "—";

    const wordsText =
      stat.words != null ? `${stat.words} words` : "—";

    const accuracyText =
      stat.acc != null ? `${stat.acc}% acc` : "—";

    return [
      svgText(
        {
          x,
          y: labelY,
          fill: theme.label,
          size: 12,
        },
        cell.label,
      ),

      svgText(
        {
          x,
          y: labelY + layout.valueDy,
          fill: theme.value,
          size: 17,
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
          size: 11,
        },
        accuracyText,
      ),
    ].join("\n  ");
  }).join("\n\n  ");

  const [topY, bottomY] = layout.rowLabelY;

  const summary = [
    svgText(
      {
        x: summaryX,
        y: topY,
        fill: theme.label,
        size: 11,
      },
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
      {
        x: summaryX,
        y: bottomY,
        fill: theme.label,
        size: 11,
      },
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
<svg width="${width}" height="${LAYOUT.height}" viewBox="0 0 ${width} ${LAYOUT.height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Monkeytype stats for ${escapeXml(stats.name)}">
  <title>Monkeytype stats - ${escapeXml(stats.name)}</title>

  <rect
    width="${width}"
    height="${LAYOUT.height}"
    rx="8"
    fill="${theme.bg}"
    stroke="${theme.border}"
    stroke-width="1"
  />

  <image
    href="${LOGOS[themeName]}"
    x="${layout.pad}"
    y="${layout.logoY}"
    width="${layout.logoSize}"
    height="${layout.logoSize}"
    preserveAspectRatio="xMidYMid meet"
  />

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
    `${stats.name} - personal bests`,
  )}

  <line
    x1="${layout.pad}"
    y1="${layout.dividerY}"
    x2="${width - layout.pad}"
    y2="${layout.dividerY}"
    stroke="${theme.border}"
    stroke-width="1"
  />

  ${cellsSvg}

  ${summary}
</svg>`;
}

async function main() {
  console.log(`Fetching Monkeytype profile for ${USERNAME}...`);

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
