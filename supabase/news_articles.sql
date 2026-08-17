-- Daily Biz & Gov: server-side news storage for supabase_sync.py
-- Run this once in Supabase Dashboard -> SQL Editor.
-- The Python sync uses canonical_url as the idempotent upsert key.

create extension if not exists pgcrypto;

create table if not exists public.news_articles (
    -- A UUIDv5 generated deterministically from canonical_url by Python.
    id uuid primary key default gen_random_uuid(),
    -- Publisher-specific ID is kept separately because IDs can collide across sites.
    source_id text,
    slug text,
    canonical_url text not null,
    source_url text not null,
    title text not null default '',
    headline_en text,
    headline_si text,
    summary text,
    summary_en text,
    summary_si text,
    content text,
    source text not null default 'Unknown',
    category text,
    author text,
    published_at timestamptz,
    scraped_at timestamptz not null default now(),

    -- Only publisher-owned image information is stored here. The secret key is
    -- never sent to the browser; local_image_path is relative to this project.
    image_url text,
    local_image_path text,
    image_alt text,
    image_mime_type text,
    image_width integer check (image_width is null or image_width >= 0),
    image_height integer check (image_height is null or image_height >= 0),
    image_bytes bigint check (image_bytes is null or image_bytes >= 0),
    image_status text not null default 'missing',

    tags jsonb not null default '[]'::jsonb
        check (jsonb_typeof(tags) = 'array'),
    takeaways jsonb not null default '[]'::jsonb
        check (jsonb_typeof(takeaways) = 'array'),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    views bigint not null default 0,

    constraint news_articles_canonical_url_key unique (canonical_url)
);

-- The project may already have the original/legacy table with only
-- id/title/slug/summary/content/source presentation fields. These statements
-- are a non-destructive migration: existing rows and IDs are retained, and the
-- richer sync columns are added in place.
alter table public.news_articles add column if not exists source_id text;
alter table public.news_articles add column if not exists slug text;
alter table public.news_articles add column if not exists canonical_url text;
alter table public.news_articles add column if not exists source_url text;
alter table public.news_articles add column if not exists headline_en text;
alter table public.news_articles add column if not exists headline_si text;
alter table public.news_articles add column if not exists summary_en text;
alter table public.news_articles add column if not exists summary_si text;
alter table public.news_articles add column if not exists source text default 'Unknown';
alter table public.news_articles add column if not exists published_at timestamptz;
alter table public.news_articles add column if not exists scraped_at timestamptz default now();
alter table public.news_articles add column if not exists local_image_path text;
alter table public.news_articles add column if not exists image_alt text;
alter table public.news_articles add column if not exists image_mime_type text;
alter table public.news_articles add column if not exists image_width integer;
alter table public.news_articles add column if not exists image_height integer;
alter table public.news_articles add column if not exists image_bytes bigint;
alter table public.news_articles add column if not exists image_status text default 'missing';
alter table public.news_articles add column if not exists tags jsonb default '[]'::jsonb;
alter table public.news_articles add column if not exists takeaways jsonb default '[]'::jsonb;
alter table public.news_articles add column if not exists views bigint default 0;

-- Existing rows can keep canonical_url NULL. Every newly synchronized row has
-- a value, and this unique index is the full-schema REST conflict target.
create unique index if not exists news_articles_canonical_url_key
    on public.news_articles (canonical_url);

create index if not exists news_articles_published_at_idx
    on public.news_articles (published_at desc nulls last);
create index if not exists news_articles_source_idx
    on public.news_articles (source);
create index if not exists news_articles_category_idx
    on public.news_articles (category);

create or replace function public.set_news_articles_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists set_news_articles_updated_at on public.news_articles;
create trigger set_news_articles_updated_at
before update on public.news_articles
for each row execute function public.set_news_articles_updated_at();

-- The backend secret/service_role can write regardless of RLS. This migration
-- intentionally does not delete existing SELECT policies or grants, because a
-- site may already use a publishable/anon key for public read-only access.
grant select, insert, update, delete on table public.news_articles to service_role;

-- For a new backend-only table, enable RLS in the Dashboard and keep anon and
-- authenticated write policies absent. If the browser needs direct reads, use
-- a SELECT-only policy with a publishable/anon key. Never expose the elevated
-- SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY in browser code.

comment on table public.news_articles is
    'Canonical, deduplicated news records synchronized by the Python backend.';
comment on column public.news_articles.canonical_url is
    'Tracking-free unique publisher URL used as the REST upsert conflict key.';
comment on column public.news_articles.local_image_path is
    'Project-relative cached publisher image path; not a Supabase Storage URL.';
