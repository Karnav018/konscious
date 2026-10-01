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

## Layout

| Path | What |
|---|---|
| `index.html` | The landing page's HTML shell: title, description, link-preview tags |
| `vite.config.ts` | **Page registry** — every page `vite build` emits is listed here |
| `src/pages/<name>/` | One folder per page: `main.tsx` (entry) + the page component |
| `src/components/` | Sections shared across pages (header, footer, …) |
| `src/site.ts` | Product copy and links: name, tagline, version, download URLs |
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

## Still to do

- Apply the real design (tokens, sections, screenshot).
- Download links in `src/site.ts` point at `#download` until there is a host
  for the DMG and installer.
- Pick a host and set up deploys; add `og:image` once there is artwork.
