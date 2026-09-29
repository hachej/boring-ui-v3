/**
 * The shell's design tokens: CSS custom properties the host sets on any ancestor (or through the `theme`
 * prop). Every default is read with `var(--token, default)` inline on the elements the shell renders, so
 * no stylesheet is injected and nothing leaks out of the component (CHAT-2, CHAT-5).
 */
export const TOKENS = {
  "--boring-font": "system-ui, sans-serif",
  "--boring-font-size": "14px",
  "--boring-fg": "#111827",
  "--boring-bg": "transparent",
  "--boring-muted": "#6b7280",
  "--boring-border": "#e5e7eb",
  "--boring-accent": "#2563eb",
  "--boring-accent-fg": "#ffffff",
  "--boring-person-bg": "#dbeafe",
  "--boring-person-fg": "#111827",
  "--boring-agent-bg": "#f3f4f6",
  "--boring-agent-fg": "#111827",
  "--boring-tool-bg": "#fafafa",
  "--boring-card-bg": "#fffbeb",
  "--boring-danger": "#b91c1c",
  "--boring-radius": "12px",
  "--boring-gap": "8px",
  "--boring-bubble-max": "80%",
} as const;

export type Token = keyof typeof TOKENS;
export type Theme = Partial<Record<Token, string>>;

/** `v("--boring-fg")` → `var(--boring-fg, #111827)`. */
export const v = (token: Token) => `var(${token}, ${TOKENS[token]})`;
