/**
 * Checks the public colour system in src/app/globals.css against the
 * accessibility promises it makes. The colours are read from the CSS itself,
 * so this cannot pass on a copy that has drifted from what ships.
 *
 *   npm run verify:theme
 *
 * 1. Contrast (WCAG 2.x): body text, accent text, white-on-accent buttons and
 *    accent text on its own soft tint all clear AAA (7:1) for every page.
 * 2. Colour-vision differences: the page accents are put through standard
 *    protanopia / deuteranopia / tritanopia simulations; every pair must stay
 *    apart by lightness or by colour (CIE76 ΔE). This is a screening check,
 *    not a substitute for looking at the page.
 * 3. The tints are quiet: soft surfaces stay light enough that nothing is
 *    harsh (relative luminance above 0.8).
 */
import { readFileSync } from "node:fs";

const css = readFileSync("src/app/globals.css", "utf8");

type Theme = Record<"accent" | "accent-soft" | "accent-wash" | "accent-ink" | "accent-line", string>;
const rootBlock = [...css.matchAll(/:root\s*\{([^}]*)\}/g)].map((m) => m[1]).find((b) => b.includes("--paper"))!;
const paper = rootBlock.match(/--paper:\s*(#[0-9a-f]{6})/i)![1];
const ink = rootBlock.match(/--ink:\s*(#[0-9a-f]{6})/i)![1];

const themes: Record<string, Theme> = {};
for (const m of css.matchAll(/\[data-page="(\w+)"\]\s*\{([^}]*)\}/g)) {
  const vars: Record<string, string> = {};
  for (const v of m[2].matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)) vars[v[1]] = v[2];
  themes[m[1]] = vars as Theme;
}

const rgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16) / 255,
  parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255,
];
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = ([r, g, b]: number[]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(rgb(a)), luminance(rgb(b))].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// Machado et al. 2009, severity 1.0, applied in linear RGB.
const MATRICES: Record<string, number[][]> = {
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
};
const simulate = (hex: string, m: number[][]) => {
  const l = rgb(hex).map(lin);
  return m.map((row) => Math.min(1, Math.max(0, row[0] * l[0] + row[1] * l[1] + row[2] * l[2])));
};
const lab = (linear: number[]) => {
  const [r, g, b] = linear;
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
};
const deltaE = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

let failures = 0;
const check = (ok: boolean, label: string, detail: string) => {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}  ${detail}`);
};

check(contrast(ink, paper) >= 12, "body text on paper", `${contrast(ink, paper).toFixed(1)}:1`);
for (const [name, t] of Object.entries(themes)) {
  const rows: [string, number, number][] = [
    ["white on accent (buttons)", contrast("#ffffff", t.accent), 7],
    ["accent-ink on paper", contrast(t["accent-ink"], paper), 7],
    ["accent-ink on accent-soft", contrast(t["accent-ink"], t["accent-soft"]), 7],
    ["ink on accent-soft", contrast(ink, t["accent-soft"]), 12],
    ["accent on paper (links, icons)", contrast(t.accent, paper), 4.5],
  ];
  for (const [label, got, need] of rows) {
    check(got >= need, `${name}: ${label}`, `${got.toFixed(2)}:1 (need ${need})`);
  }
  for (const key of ["accent-soft", "accent-wash"] as const) {
    const y = luminance(rgb(t[key]));
    check(y > 0.8, `${name}: ${key} stays soft`, `luminance ${y.toFixed(2)}`);
  }
}

const visible = Object.keys(themes).filter((n) => n !== "print");
for (const [kind, m] of Object.entries(MATRICES)) {
  for (let i = 0; i < visible.length; i++) {
    for (let j = i + 1; j < visible.length; j++) {
      const a = lab(simulate(themes[visible[i]].accent, m));
      const b = lab(simulate(themes[visible[j]].accent, m));
      const dE = deltaE(a, b);
      const dL = Math.abs(a[0] - b[0]);
      check(dE >= 12 || dL >= 8, `${kind}: ${visible[i]} vs ${visible[j]} stay apart`, `ΔE ${dE.toFixed(0)}, ΔL ${dL.toFixed(0)}`);
    }
  }
}

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\ntheme checks passed");
