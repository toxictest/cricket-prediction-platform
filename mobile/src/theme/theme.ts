import { MD3DarkTheme, type MD3Theme } from "react-native-paper";

/**
 * The mobile palette is the web app's cyberpunk theme, reduced to what survives on
 * a 6-inch screen: one accent, one signal colour, and borders that read as lines
 * rather than as glow.
 */
export const colors = {
  background: "#05070D",
  surface: "#0B1220",
  surfaceAlt: "#111B2E",
  border: "#1E2B45",
  borderBright: "#2C3F63",
  text: "#E6EDF7",
  textMuted: "#8B9AB4",
  cyan: "#22D3EE",
  magenta: "#E879F9",
  success: "#34D399",
  warning: "#FBBF24",
  danger: "#F87171",
  /** Deposit tokens are cyan, winning tokens are magenta: the two balances must never look interchangeable. */
  deposit: "#22D3EE",
  winning: "#E879F9",
} as const;

export const paperTheme: MD3Theme = {
  ...MD3DarkTheme,
  roundness: 14,
  colors: {
    ...MD3DarkTheme.colors,
    primary: colors.cyan,
    secondary: colors.magenta,
    background: colors.background,
    surface: colors.surface,
    surfaceVariant: colors.surfaceAlt,
    elevation: {
      ...MD3DarkTheme.colors.elevation,
      level0: colors.background,
      level1: colors.surface,
      level2: colors.surface,
      level3: colors.surfaceAlt,
    },
    onSurface: colors.text,
    onSurfaceVariant: colors.textMuted,
    onPrimary: "#04121A",
    outline: colors.border,
    outlineVariant: colors.border,
    error: colors.danger,
  },
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

/** Status pills, so a match, a claim and a payout use one vocabulary. */
export const statusColors: Record<string, string> = {
  LIVE: colors.danger,
  UPCOMING: colors.cyan,
  COMPLETED: colors.textMuted,
  PENDING: colors.warning,
  APPROVED: colors.success,
  REJECTED: colors.danger,
};
