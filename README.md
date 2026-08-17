# Ceylon Ledger

Ceylon Ledger is a review-first Sri Lankan business news platform. It keeps
publisher text as an immutable source record, creates a separate Groq draft,
requires an editor to review that draft, and exposes only an explicitly
published version to the public React site.

The visual direction follows the supplied editorial reference—strong black
navigation, large story typography and image-led layouts—while using a distinct
cobalt/coral identity and responsive component system.

## System layout

```text
Publisher sites
      │
      ▼
Python collectors ──► raw source row in Supabase
      │                         │
      ▼                         ▼
Groq guarded rewrite ──► immutable AI article_version
                                  │
                                  ▼
                         React admin dashboard
                         edit → preview → approve
                                  │
                                  ▼
                      immutable published_version
                                  │
                                  ▼
                         Public React website
```

| Part | Location | Development URL |
| --- | --- | --- |
| Public React site | `apps/public` | `http://localhost:5173` |
| React admin dashboard | `apps/admin` | `http://localhost:5174` |
| Express API and scheduler | `server.js`, `editorial/` | `http://localhost:5000` |
| Scraper and AI worker | `daily_runner.py`, `unified_scraper.py`, `groq_ai_processor.py` | server process |
| Database migrations | `supabase/` | Supabase |

The public app includes Home, Business News, Interviews & Appointments, Money,
Technology, Travel & Tourism and Luxury Living routes, article detail pages,
responsive live-feed search/navigation, and up to ten ordered Top News
positions. With `VITE_DEMO_MODE=false`, API failures, empty feeds and related
stories never fall back to bundled samples; the page shows an honest
unavailable or empty state instead.

The admin app is a separate build and URL. It includes the article queues,
source-versus-draft editor, validation warnings, manual collection control,
preview links, approval-to-public actions, source registry/health views and a
published-only Top News manager.

## First local run

Requirements: Node.js 20+, Python 3.11+ and a Supabase project for production
storage. Bundled samples are available only when a developer explicitly sets
`VITE_DEMO_MODE=true` in `apps/public/.env.local`.

```powershell
cd D:\Newssite2\newssite
Copy-Item .env.example .env
npm install
pip install -r requirements.txt

cd apps\public
npm install

cd ..\admin
npm install
```

Edit the root `.env`; secrets belong only there. Never place a Groq API key or
Supabase secret/service-role key in either React application's `VITE_*`
variables.

Start three terminals:

```powershell
# Terminal 1 — API, scheduler and editorial backend
cd D:\Newssite2\newssite
npm start

# Terminal 2 — public website
cd D:\Newssite2\newssite
npm run dev:public

# Terminal 3 — private admin dashboard
cd D:\Newssite2\newssite
npm run dev:admin
```

For local review, when `ADMIN_EMAIL` and both password settings are absent, the API
offers `editor@ceylonledger.local` / `editor-demo-2026`. These defaults are
disabled in production. Configure `ADMIN_PASSWORD_HASH` as
`scrypt$<salt-hex>$<digest-hex>` (plain `ADMIN_PASSWORD` is retained for local
tests only), plus independent random values for `ADMIN_SESSION_SECRET` and
`PREVIEW_TOKEN_SECRET` before deployment.
An API-authenticated login is never converted into the browser demo. Demo mode
is entered only through **Open demo newsroom**; build the production admin app
with `VITE_DEMO_MODE=false`. Admin sessions expire after 12 hours, and the
dashboard clears rejected or expired bearer sessions instead of retaining a
stale login.

The public app has an independent setting in `apps/public/.env.local`. Keep
`VITE_DEMO_MODE=false` for live use. When false, it also rejects API responses
marked `demo: true`, searches only the fetched published feed, and loads article
recommendations only from the live category endpoint.

## Supabase setup

Run these scripts once, in order, in the Supabase SQL editor:

1. `supabase/news_articles.sql`
2. `supabase/editorial_workflow.sql`

The workflow migration requires the UUID `news_articles.id` created by the
first script. If an older installation replaced that key with bigint/text, move
those legacy IDs into a separate publisher-ID column and convert the primary
key before applying the workflow migration; the script now stops early with a
clear error instead of creating incompatible foreign keys.

Then set:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://PROJECT.supabase.co
SUPABASE_SECRET_KEY=YOUR_SERVER_ONLY_SECRET
SUPABASE_SYNC_ENABLED=true
EDITORIAL_BACKEND=auto
```

`auto` uses Supabase when the editorial views are available and otherwise uses
the clearly labelled local backend during development. A strict public build
with `VITE_DEMO_MODE=false` rejects that demo-labelled response. Production
requires Supabase and returns a service error instead of silently publishing
demo data.

The additive migration creates categories, publisher sources, admin profiles,
immutable article versions, audit actions, ten Top News slots, preview-token
storage and row-level security. Public clients can read only the
`published_articles` and `published_top_news` projections. Original copy,
reviewer data, warnings, prompt metadata, credentials and unpublished drafts
are not publicly selectable.

## Collection and AI drafting

Automatic collection is enabled by the scheduler settings in `.env`. A run can
also be started from Admin → Sources or directly with the protected admin API.
The per-source switches are read from the Supabase source registry before each
global Python run. Disabling a source prevents its adapter from running on the
next collection; a registry-read failure in strict Supabase mode fails the run
instead of scraping publishers whose operator setting is unknown.

To generate Groq drafts:

```dotenv
AI_ENABLED=true
AI_MAX_ARTICLES=30
AI_REQUEST_DELAY_SECONDS=10
GROQ_API_KEY=YOUR_SERVER_ONLY_KEY
GROQ_MODEL=openai/gpt-oss-20b
```

The normal pipeline is:

```powershell
python daily_runner.py
```

It collects publisher records, optionally creates review-only Groq drafts,
reuses a prior draft only when its model, prompt version and exact source text
hash still match, merges local exports without erasing an older draft, and synchronizes both
the raw source rows and immutable AI versions to Supabase. Identical drafts use
deterministic IDs, so retrying a run does not create duplicate versions. A
background run cannot overwrite an editor version or an approved, scheduled,
published, rejected or changes-requested article. In strict Supabase mode a
database-delivery failure fails the run and triggers the configured retry; it
is never reported as a successful live refresh.

Currently verified automated adapters cover Daily Mirror, Ada Derana, News
First, Hiru News, Daily FT, EconomyNext, SriLankaBiz, The Island, Daily News,
Sri Lanka Mirror and Sunday Observer, plus the existing LBO and Business Today
collectors. The official CAASL RSS feed, Sri Lanka Army public news listing,
The Morning public Next.js homepage payload and Xinhua's Asia-Pacific listing
are also collected. Xinhua is restricted to headlines that explicitly name
Sri Lanka so unrelated regional wire copy is not imported.

`news.lk` remains a paused/manual-review source. Its public Joomla API requires
authentication and its listing/feed routes are challenge-protected, so the
collector does not bypass those controls or pretend that source is healthy.

Only a publisher's own image URL or a locally cached copy of that image is
used. The system does not attach unrelated stock images.

## Why this uses a guarded prompt, not RAG

RAG is useful when a model must retrieve facts from a separate knowledge base.
Here, the authoritative context is one complete publisher article, so adding a
retrieval layer would increase the chance of mixing stories. The AI step uses a
strict system prompt plus deterministic post-generation validation instead:

- the article is labelled untrusted data, so instructions inside it are never
  followed;
- names, roles, organisations, dates, money, percentages, measurements,
  decisions, attribution and uncertainty must be preserved;
- losses, declines, failures and criticism cannot be converted into positive
  outcomes;
- “constructive” permits calmer wording only, not changed meaning;
- no outside facts, browsing, inference or opinion are allowed;
- numeric facts, qualifiers, polarity and injection-like phrases are checked
  again in code;
- any validation error marks the draft for human review and blocks approval.

The prompt lives in `groq_ai_processor.py`; deterministic checks live in
`editorial_validator.py`. The model never publishes directly.

## Editorial workflow

```text
scraped → ai_processing → pending_review ── approve ──► published
                               │                         ▲
                               ├─ changes_requested      │
                               └─ rejected / failed      │
                                      approved (recovery only)
```

1. The publisher article is stored unchanged.
2. Groq creates a separate draft version.
3. An editor compares the original and draft, fixes copy and resolves errors.
4. Preview generates a signed 30-minute URL on the public design with a
   NOT PUBLISHED banner and `noindex` headers. Production stores only its
   SHA-256 hash so expiry, revocation and use tracking do not expose the token.
5. Approve records the editorial decision and immediately publishes that exact
   reviewed version. The separate Publish endpoint remains only to recover
   pre-existing or interrupted records already left in `approved` status.
6. Top News accepts only published stories and stores at most ten ordered slots.

The 25 titles supplied in the project brief are seeded into the pending queue,
five for each requested editorial category. The brief supplied publisher home
pages rather than exact article URLs, so those entries deliberately carry a
blocking “verify exact article URL” check. They cannot be approved until an
editor imports/verifies the full publisher article and its image. This prevents
invented copy from reaching the site.

## API summary

Public:

- `GET /api/public/home`
- `GET /api/public/top-news?limit=10`
- `GET /api/public/categories/:slug`
- `GET /api/public/articles/:slug`
- `GET /api/preview/:token`

Admin (Bearer session required except login):

- `POST /api/admin/login`
- `GET/PATCH /api/admin/articles/:id`
- `POST /api/admin/articles/:id/rewrite`
- `POST /api/admin/articles/:id/approve` (approves and publishes)
- `POST /api/admin/articles/:id/publish` (approved-row recovery)
- `POST /api/admin/articles/:id/reject`
- `POST /api/admin/articles/:id/preview-token`
- `GET/PUT /api/admin/top-news`
- `GET/PATCH /api/admin/sources/:id`
- `POST /api/admin/scraper/run`
- `GET /api/admin/scraper/status`

## Checks and production builds

```powershell
cd D:\Newssite2\newssite
npm test
npm run build:apps
```

For deployment, serve `apps/public/dist` at the public domain and
`apps/admin/dist` at a separate protected admin domain. Both need SPA history
fallback. Run `server.js` as the API service, allow only the two real origins,
set `NODE_ENV=production`, use HTTPS, configure strong admin/session secrets,
and keep the Supabase secret and Groq key only in the API/worker environment.
# newssite
