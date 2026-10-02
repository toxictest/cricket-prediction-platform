import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: {
        DEFAULT: "1rem",
        sm: "1.5rem",
        lg: "2rem",
      },
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        /* ---- Cyberpunk design tokens (brand scale) ---- */
        cyber: {
          void: "#09090b",
          abyss: "#050507",
          panel: "#0d0d11",
          steel: "#18181b",
          ash: "#27272a",
          neon: "#ef4444",
          ember: "#b91c1c",
          flare: "#fb7185",
          plasma: "#f97316",
          cyan: "#22d3ee",
          lime: "#a3e635",
          text: "#e4e4e7",
          dim: "#a1a1aa",
          faint: "#52525b",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
        display: ["var(--font-display)", "var(--font-sans)", "sans-serif"],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      boxShadow: {
        "neon-xs": "0 0 4px rgba(239,68,68,0.55)",
        "neon-sm":
          "0 0 8px rgba(239,68,68,0.45), 0 0 2px rgba(239,68,68,0.7)",
        neon:
          "0 0 14px rgba(239,68,68,0.5), 0 0 4px rgba(239,68,68,0.75)",
        "neon-lg":
          "0 0 28px rgba(239,68,68,0.45), 0 0 8px rgba(239,68,68,0.65)",
        "neon-inset": "inset 0 0 18px rgba(239,68,68,0.22)",
        "glass":
          "0 8px 32px 0 rgba(0,0,0,0.65), inset 0 1px 0 0 rgba(255,255,255,0.05)",
        "inner-line": "inset 0 1px 0 0 rgba(255,255,255,0.06)",
      },
      backgroundImage: {
        "cyber-grid":
          "linear-gradient(rgba(239,68,68,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(239,68,68,0.08) 1px, transparent 1px)",
        "cyber-grid-fine":
          "linear-gradient(rgba(239,68,68,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(239,68,68,0.05) 1px, transparent 1px)",
        "cyber-radial":
          "radial-gradient(ellipse 80% 60% at 50% -10%, rgba(239,68,68,0.22), transparent 70%)",
        "neon-sweep":
          "linear-gradient(110deg, transparent 25%, rgba(239,68,68,0.28) 50%, transparent 75%)",
        "ember-fade":
          "linear-gradient(180deg, rgba(239,68,68,0.14) 0%, rgba(9,9,11,0) 100%)",
      },
      backgroundSize: {
        "grid-32": "32px 32px",
        "grid-64": "64px 64px",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "pulse-glow": {
          "0%, 100%": {
            boxShadow:
              "0 0 12px rgba(239,68,68,0.35), 0 0 3px rgba(239,68,68,0.6)",
          },
          "50%": {
            boxShadow:
              "0 0 32px rgba(239,68,68,0.75), 0 0 10px rgba(239,68,68,0.9)",
          },
        },
        flicker: {
          "0%, 100%": { opacity: "1" },
          "41%": { opacity: "1" },
          "42%": { opacity: "0.55" },
          "43%": { opacity: "1" },
          "77%": { opacity: "1" },
          "78%": { opacity: "0.35" },
          "79%": { opacity: "1" },
        },
        scanline: {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100%)" },
        },
        "grid-drift": {
          "0%": { backgroundPosition: "0px 0px, 0px 0px" },
          "100%": { backgroundPosition: "64px 64px, 64px 64px" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-8px)" },
        },
        "float-slow": {
          "0%, 100%": { transform: "translateY(0) scale(1)" },
          "50%": { transform: "translateY(-14px) scale(1.02)" },
        },
        "ember-rise": {
          "0%": { transform: "translateY(0) scale(1)", opacity: "0" },
          "10%": { opacity: "0.9" },
          "100%": { transform: "translateY(-120px) scale(0.4)", opacity: "0" },
        },
        "sweep-x": {
          "0%": { transform: "translateX(-120%)" },
          "100%": { transform: "translateX(120%)" },
        },
        "caret-blink": {
          "0%, 70%, 100%": { opacity: "1" },
          "20%, 50%": { opacity: "0" },
        },
        "spin-slow": {
          from: { transform: "rotate(0deg)" },
          to: { transform: "rotate(360deg)" },
        },
        "text-shimmer": {
          "0%": { backgroundPosition: "0% 50%" },
          "100%": { backgroundPosition: "200% 50%" },
        },
        "border-run": {
          "0%, 100%": { transform: "translateX(0%)" },
          "50%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "pulse-glow": "pulse-glow 3s ease-in-out infinite",
        flicker: "flicker 4.5s linear infinite",
        scanline: "scanline 5s linear infinite",
        "grid-drift": "grid-drift 24s linear infinite",
        float: "float 4s ease-in-out infinite",
        "float-slow": "float-slow 7s ease-in-out infinite",
        "ember-rise": "ember-rise 3s linear infinite",
        "sweep-x": "sweep-x 2.8s ease-in-out infinite",
        "caret-blink": "caret-blink 1.1s step-end infinite",
        "spin-slow": "spin-slow 14s linear infinite",
        "text-shimmer": "text-shimmer 4s linear infinite",
        "border-run": "border-run 3s ease-in-out infinite",
      },
      transitionTimingFunction: {
        cyber: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
