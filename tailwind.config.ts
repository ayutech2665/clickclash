import type { Config } from "tailwindcss";

// ClickClash Crayon Theme
// Pastel palette with hand-drawn aesthetic tokens.
// All colors reference CSS variables defined in globals.css so they
// can be tweaked in one place without touching the config.

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      // ---- Crayon color palette ----
      colors: {
        crayon: {
          cream:   "#FFF8ED",   // page background
          paper:   "#FFF3D6",   // card surface
          yellow:  "#FFD166",   // primary accent
          orange:  "#FF9A3C",   // hover / active
          pink:    "#FF6B9D",   // secondary accent
          blue:    "#6BCBFF",   // info / waiting
          teal:    "#4ECDC4",   // success-ish
          green:   "#A8E6CF",   // join / confirm
          purple:  "#C3A1FF",   // category tag
          red:     "#FF6B6B",   // error / warning
          ink:     "#2D2D2D",   // main text
          muted:   "#7A7A6E",   // secondary text
          border:  "#3D3929",   // hand-drawn border color
        },
      },
      // ---- Font ----
      fontFamily: {
        crayon: ["'Patrick Hand'", "cursive"],
      },
      // ---- Spacing extras for touch targets ----
      minHeight: {
        touch: "44px",
      },
      // ---- Border radius ----
      borderRadius: {
        crayon: "12px",
        "crayon-lg": "20px",
      },
      // ---- Box shadow (offset gives hand-drawn feel) ----
      boxShadow: {
        crayon:    "3px 3px 0px #3D3929",
        "crayon-sm": "2px 2px 0px #3D3929",
        "crayon-lg": "5px 5px 0px #3D3929",
      },
      // ---- Background size for repeating texture ----
      backgroundSize: {
        texture: "4px 4px",
      },
    },
  },
  plugins: [],
};

export default config;
