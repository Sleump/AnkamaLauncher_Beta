# Reference material from the real Ankama Launcher (temporary, to remove after study)

Extracted/copied on 2026-10-17 from a local install of the official Ankama Launcher
(v3.15.5, build `52427f929520c87320fd4c0e131a6fe24108191c`, built 2026-09-09) and its
cached game data, for comparison against this fork. Not meant to stay in the repo
long-term.

## real-launcher-app/ (from resources/app.asar)

The entire app (`main.js`, `preload.js`, `renderer.js`, ~3MB each) is a single
webpack-bundled, minified file per process — there is no standalone `hero`
component, `scriptSpawner.js`, `games/configuration.js`, `games/checkConfiguration.js`,
or `games/release.js` file anywhere in the asar. Those modules exist (confirmed via
string search — `scriptSpawner`, `checkConfiguration`, `zaap.yml` all appear as
identifiers/strings inside `main.js`) but are inlined as numbered webpack modules
(e.g. `n(152)`, `n(798)`) inside the single minified bundle, so they aren't usable
as readable source. Only `package.json` was kept — it has the real app config
(API URLs, enabled features, themes list, dependency versions).

No example `zaap.yml` / `zaap-start.bat` file ships inside the launcher app itself;
`zaap.yml` is just referenced by filename in the code (read from a game's own
install folder at runtime), not bundled as a sample.

## real-launcher-static/ (from resources/static)

Readable text/html/css/json only — theme CSS (4 themes), UI language files,
and the notification/overlay/provider HTML shells. Images, fonts, and icons were
skipped.

## real-hero-example/ (from a real cached game — NOT from the launcher app)

This is the actually useful part. Found via
`%APPDATA%\zaap\repositories\production\waven\beta\data\installed\hero\`
— the "hero" component for the game **Waven**, which does exist and ships as
real per-game files (downloaded as part of the game's own data, not part of the
launcher bundle):

- `index.html` / `index.js` / `style.css` — a small Vue component. `index.js`
  reads `this.$store.getters.displayedRelease` and uses
  `release.information.url` as `baseUrl` to resolve `background.jpg` /
  `foreground.png`.
- `release.json` (copied from the parent `data/` folder) — shows the real
  release schema: `displayName`, `style.primaryColor` /
  `lightenPrimaryColor` / `colorPrimary(Light/Dark)` (RGB objects), `ratings`,
  `links`, `components` (array of `{name, component, props}` — dynamically
  rendered page sections), `genres`, etc.

No `hero` folder was found for the `dofus-retro-elbustemu` test repo (a non-Ankama
private-server install already present locally) — confirms not every game ships
a custom hero; it's opt-in per release.
