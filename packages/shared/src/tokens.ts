// Design tokens extracted from the Relay prototype (Relay Platform.dc.html).
// Single source of truth for colors / fonts so web stays pixel-faithful.

export const colors = {
  bg: "#f4f1ea",
  surface: "#ffffff",
  surfaceAlt: "#faf8f4",
  surfaceSunken: "#fbf9f4",
  ink: "#1b1714",
  inkPanel: "#2a2520",
  inkPanelAlt: "#3a332c",

  accent: "#ff6a1a", // Relay orange
  accentSoft: "#fff0e6",
  accentSoftBorder: "#ffd9c2",
  accentSoftBg: "#fff6f0",

  muted: "#6b6258",
  muted2: "#8c8378",
  muted3: "#a39a8d",
  muted4: "#b3aa9c",

  border: "#e9e3d8",
  border2: "#e3ddd1",
  border3: "#ece6db",
  hairline: "#f1ece2",

  green: "#1f9d6b",
  greenSoft: "#e7f6ee",
  blue: "#2f6bff",
  blueSoft: "#e9f0ff",
  blueInfoBg: "#eef5ff",
  blueInfoBorder: "#d8e6ff",
  purple: "#7c5cff",
  purpleSoft: "#efeaff",
  danger: "#c2553f",
} as const;

export const fonts = {
  display: "'Space Grotesk', sans-serif",
  body: "'Manrope', sans-serif",
  mono: "'JetBrains Mono', monospace",
} as const;

export const radius = {
  sm: "9px",
  md: "13px",
  lg: "18px",
  xl: "22px",
  pill: "30px",
} as const;

export const fontImportUrl =
  "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Manrope:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600;700&display=swap";
