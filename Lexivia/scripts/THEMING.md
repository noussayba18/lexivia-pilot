Lexivia themes
==============

Appearance is stored locally under `lexivia-theme`. Light is the default;
System follows `prefers-color-scheme`. `src/theme.js` handles switching and
cross-tab updates; the early script in `index.html` prevents a light flash.

`src/styles/theme.css` defines the dark semantic tokens. The Vite PostCSS
plugin in `themeColors.js` adapts existing page styles, including CSS modules,
while retaining original light colors as fallbacks. Navy button backgrounds,
artwork, shadows and theme swatches stay unchanged. Inline React styles use
the same tokens explicitly; new inline styles should do the same, for example
`color: 'var(--lx-ink, #211f54)'`.

Use `npm run test:theme` to check preference behavior and CSS adaptation.
`migrateInlineTheme.mjs` is a one-time, AST-based migration utility; it is not
part of the runtime and does not need to run during builds.
