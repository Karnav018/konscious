# Konscious website

The public site: the landing page now, more pages later. Vite + React 19 +
TypeScript + Tailwind 4, the same stack as the app's frontend. It shares no
code with `app/`; brand values are copied into `src/styles/tokens.css`.

```sh
cd site
pnpm install
pnpm dev          # http://localhost:1430 (the app's dev server owns 1420)
pnpm typecheck
pnpm build        # → dist/, static files ready to host
pnpm preview      # serve dist/ on :1431 to check the real build
```

Or from the repo root: `scripts/build-site.sh`.

## Live site

https://konscious.hawkapp.in — the Vercel project `konscious` (scope
`karnav018s-projects`). Deploy with `scripts/deploy-site.sh` from the repo root;
build settings and asset caching are in `vercel.json`. DNS for `hawkapp.in` is
at GoDaddy: the subdomain is an `A` record `konscious → 76.76.21.21`.

## Layout

| Path | What |
|---|---|
| `index.html` | The landing page's HTML shell: title, description, link-preview tags |
| `vite.config.ts` | **Page registry** — every page `vite build` emits is listed here |
| `src/pages/<name>/` | One folder per page: `main.tsx` (entry) + the page component |
| `src/components/` | Sections shared across pages (header, footer, …) |
| `src/site.ts` | Product copy and links: name, tagline, download labels |
| `src/release.ts`, `src/useDownloads.ts` | The newest GitHub release and the download buttons built from it |
| `src/styles/tokens.css` | Colors, fonts, radii. Placeholder until the design lands |
| `src/lib/mount.tsx` | Loads fonts + global CSS and mounts a page |
| `public/` | Copied as-is: favicon, icon, future og-image |

## Adding a page

Say `/changelog`:

1. Copy `index.html` to `changelog.html`; change its `<title>`, description,
   and the `<script>` to `/src/pages/changelog/main.tsx`.
2. Create `src/pages/changelog/Changelog.tsx` and
   `src/pages/changelog/main.tsx` containing `mount(<Changelog />)`.
3. Register it in `vite.config.ts`: `changelog: 'changelog.html'`.

The dev server shows any HTML file without step 3, so a page you forget to
register works in `pnpm dev` and is missing from the build — check with
`pnpm build && ls dist`.

## How the landing page is built

Every picture is the real app: `public/app-window.png` (a 2x screenshot) is
shown whole in the hero, and each feature row shows a crop of it through
`<Crop region={…}>` in `src/components/Shot.tsx`. A region is in the PNG's own
pixels; `scale` 0.5 means actual on-screen size. Replacing the screenshot
means re-measuring the regions in `src/components/Features.tsx`.

Download buttons follow the newest published GitHub release by themselves —
the same release the app updates from — so a new release needs no change and
no deploy here:

1. At build time, `vite.config.ts` asks GitHub for the latest release and bakes
   it in as the page's starting point (version, file names, sizes).
2. When the page loads, `src/useDownloads.ts` asks GitHub again
   (`api.github.com/repos/Karnav018/konscious/releases/latest`) and switches
   the buttons, version and sizes to whatever is newest. The answer is kept
   for ten minutes per tab: GitHub allows 60 such requests an hour per visitor.
3. If both fail, the buttons open the release page on GitHub, which always
   lists the newest files.

Installers are found by name (`*-universal.dmg`, `*_x64-setup.exe`, as
`.github/workflows/release.yml` names them; see `src/release.ts`). Drafts and
pre-releases are never "latest", so they never reach the site. GitHub serves
the files as attachments, so a click saves the file without leaving the page.
