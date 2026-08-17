# Ceylon Ledger public web

Public React + Vite news experience for the Ceylon Ledger editorial workflow.

## Run locally

```powershell
cd D:\Newssite2\newssite\apps\public
npm install
npm run dev
```

Vite starts at `http://localhost:5173` and proxies `/api` plus the supported
local image directories to the Express service at `http://localhost:5000`.

To point the app to another API origin, copy `.env.example` to `.env` and set:

```text
VITE_API_BASE_URL=https://api.example.lk
VITE_DEMO_MODE=false
```

`VITE_DEMO_MODE=false` is the live-safe default in `.env.local` and in the
example file. In this mode, an unavailable API renders a retryable service
state, a successful empty response renders “No published stories yet”, and an
API response marked `demo: true` is rejected. Search uses the fetched public
feed, while article recommendations come from the live category endpoint.

Set `VITE_DEMO_MODE=true` only when intentionally reviewing the bundled sample
content during local UI development.

## Expected public API

- `GET /api/public/home`
- `GET /api/public/top-news?limit=10`
- `GET /api/public/categories/:slug`
- `GET /api/public/articles/:slug`
- `GET /api/preview/:token` (returns `{ "article": ... }`)

List endpoints may return an array or an object containing `articles`, `data`, or `items`. Home may additionally return `topNews` / `top_news`. Article fields are normalized in `src/api.js`, including common snake_case fields.

Bundled data in `src/data.js` is never used unless `VITE_DEMO_MODE=true`.
Relative asset paths such as `/assets/news_images/example.jpg` are resolved
against `VITE_API_BASE_URL` when configured.

## Production build

```powershell
npm run build
npm run preview
```

Deploy the generated `dist` directory with SPA history fallback enabled so category routes such as `/technology`, article routes under `/article/...`, and preview routes serve `index.html`. The legacy-friendly `/category/:slug` alias also remains available.

The `/preview/:token` route renders the standard article view with an editorial preview banner and injects `noindex, nofollow, noarchive` while mounted. Expired or invalid tokens do not fall back to demonstration content.
