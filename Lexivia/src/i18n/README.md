Interface languages
===================

`useLanguage()` subscribes a component to the saved English, French or Arabic
interface language. `t(source, values)` translates catalogued interface phrases.
Unknown phrases retain their English source; user-written content and code must
not be translated. Keep API enum values, routes, filter keys and form values in
their original format, and translate only the displayed labels.

The preference uses `lexivia-language` in browser storage. Arabic sets the page
language and RTL direction; email addresses, passwords and code remain LTR.
`index.html` restores direction before the application renders.

Feature catalogs cover navigation, authentication, profiles, teams, resources,
competition creation and management, collection, annotation, datasets, model
workspaces and notifications. Built-in registry labels are translated at render
time; enum values and organizer-defined labels remain unchanged. Language changes
rerender subscribed components without resetting their form state.

Use placeholders such as `{provider}` for dynamic text. Do not concatenate
translated sentence fragments. Formatted application validation messages and
notification templates also resolve through the catalog, preserving inserted
names and content. Unknown external/server messages retain their source text.
`format.js` provides localized relative times and duration units; other dates use
the selected document language.

`npm run test:language` checks persistence, direction, interpolation, inserted user
content, localized time units and invariant machine-readable JSX attributes.
`npm run audit:language` scans JSX, UI metadata, validation messages and templates
for phrases missing French or Arabic translations. It writes a report to
`outputs/localization/missing.json` and fails when entries are missing. Technical
formats, code identifiers, CSS values and proper names are intentionally invariant.
`scripts/localize-ui.mjs` is a source migration helper for static JSX literals.
It is not a runtime DOM translator and is not required during builds.
