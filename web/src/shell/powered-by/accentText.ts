/** WCAG AA contrast for normal text. */
const AA = 4.5;

const channels = (hex: string): [number, number, number] => {
  const digits = hex.slice(1);
  const full = digits.length === 3 ? [...digits].map((c) => c + c).join("") : digits;
  return [0, 2, 4].map((at) => parseInt(full.slice(at, at + 2), 16)) as [number, number, number];
};

const toHex = (rgb: readonly number[]): string =>
  `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;

/** WCAG relative luminance of an sRGB colour. */
function luminance(rgb: readonly number[]): number {
  const [r, g, b] = rgb.map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The contrast ratio of a `#rgb`/`#rrggbb` colour with white. */
export function contrastWithWhite(hex: string): number {
  return 1.05 / (luminance(channels(hex)) + 0.05);
}

/**
 * The accent colour for text on white: the colour itself when it reads (4.5:1), else the same hue
 * darkened towards black until it does. Links and Sign Out use it; borders keep the accent.
 */
export function accentTextColor(hex: string): string {
  const rgb = channels(hex);
  for (let step = 0; step <= 20; step += 1) {
    const shade = toHex(rgb.map((c) => c * (1 - step / 20)));
    if (contrastWithWhite(shade) >= AA) return shade;
  }
  return "#000000";
}
