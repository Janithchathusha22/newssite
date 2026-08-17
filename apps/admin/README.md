# Ceylon Ledger Admin

A separate React + Vite editorial dashboard for the news workflow. It includes a complete browser-backed demo mode, so every core screen can be reviewed before the production API is available.

## Included

- Protected API login plus an explicit, isolated browser demo
- Editorial overview, metrics and activity timeline
- Pending, all, published and rejected article queues
- Side-by-side source-versus-draft editor
- AI validation warnings and source metadata
- Save, regenerate, approve, publish and reject actions
- Public-site styled preview and expiring preview-link request
- Top News positions 1–10 with ordering and story replacement
- Publisher source health and enable/pause controls
- Responsive desktop, tablet and mobile layouts
- Typed API client that accepts wrapped (`{ articles: [...] }`) or raw arrays

Demo actions are saved to browser `localStorage`. Use **Open demo newsroom** on the login screen. Normal sign-in always uses `/api/admin/login` and never silently changes to demo data after a network, server, validation or authorization error.

The **Keep me signed in** option stores a validated, expiring session in `localStorage`. When unchecked, it uses `sessionStorage` and ends with the browser tab/session. Expired, malformed and legacy demo sessions are discarded. A `401` from any initial protected request signs the user out instead of leaving a stale dashboard open.

## Run

```bash
cd apps/admin
npm install
npm run dev
```

The dashboard opens at `http://localhost:5174`.

Production checks:

```bash
npm run typecheck
npm run build
npm run preview
```

## Environment

Copy `.env.example` to `.env.local`:

```env
VITE_ADMIN_API_URL=
VITE_DEMO_MODE=true
VITE_PUBLIC_SITE_URL=http://localhost:5173
```

- Leave `VITE_ADMIN_API_URL` empty for same-origin `/api`; Vite proxies it to `localhost:5000` during development.
- Set an absolute API URL only for a split-domain deployment.
- `VITE_DEMO_MODE=true` enables the explicit **Open demo newsroom** action. Set it to `false` for production builds.
- Demo data is selected only by the dedicated demo token. A live API session never falls back to browser data, so failed writes cannot appear successful locally.
- Groq and Supabase service-role secrets must remain on the backend; do not put them in this app.

## API contract

All protected requests send `Authorization: Bearer <token>`.

| Method | Route | Shape |
| --- | --- | --- |
| POST | `/api/admin/login` | `{ email, password }` → `{ token, user, demo: false, expiresAt }` |
| GET | `/api/admin/articles` | `{ articles: Article[] }` or `Article[]` |
| GET | `/api/admin/articles/:id` | `{ article }` or `Article` |
| PATCH | `/api/admin/articles/:id` | `ArticlePatch` → `{ article }` or `Article` |
| POST | `/api/admin/articles/:id/approve` | approves, publishes, and returns the live article |
| POST | `/api/admin/articles/:id/publish` | publishes a pre-existing approved article (recovery) |
| POST | `/api/admin/articles/:id/reject` | `{ reason }` → updated article |
| POST | `/api/admin/articles/:id/rewrite` | → updated article |
| POST | `/api/admin/articles/:id/preview-token` | → `{ token, url?, expiresAt }` |
| GET/PUT | `/api/admin/top-news` | GET list; PUT `{ articleIds }` |
| GET | `/api/admin/sources` | `{ sources: NewsSource[] }` or array |
| PATCH | `/api/admin/sources/:id` | `{ enabled }` → updated source |
| POST | `/api/admin/scraper/run` | starts the global server-configured pipeline; `202` when started, `409` when unavailable |
| GET | `/api/admin/scraper/status` | live scheduler, feed, and collection-run state |
| GET | `/api/admin/events` | `{ events: EditorialEvent[] }` or array |

The authoritative TypeScript field definitions are in `src/types.ts`; transport and fallback behavior is in `src/lib/api.ts`.
The per-source `enabled` value is loaded by the Python worker before each run.
Disabling a row pauses that publisher on the next collection. A strict
Supabase-mode run aborts before contacting publishers if it cannot read this
registry, so an unknown control state never silently re-enables a source.

## Deploy

`npm run build` produces `dist/`. Configure the host to return `index.html` for client routes such as `/articles/:id/edit`. Use a separate admin domain (for example `admin.example.lk`), build with `VITE_DEMO_MODE=false`, and enforce real authentication plus role checks on every API mutation.
