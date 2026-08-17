-- Daily Biz & Gov editorial workflow
--
-- Run after supabase/news_articles.sql in Supabase Dashboard -> SQL Editor.
-- This migration is additive: the existing scraper columns and canonical_url
-- upsert contract remain unchanged. Newly synchronized articles default to
-- `scraped` and cannot be read anonymously until an editor publishes them.

create extension if not exists pgcrypto;

-- PostgreSQL does not support CREATE TYPE IF NOT EXISTS on all Supabase
-- versions, so enum creation is guarded through the system catalogue.
do $$
begin
    if not exists (
        select 1
        from pg_type t
        join pg_namespace n on n.oid = t.typnamespace
        where n.nspname = 'public' and t.typname = 'news_workflow_status'
    ) then
        create type public.news_workflow_status as enum (
            'scraped',
            'ai_processing',
            'pending_review',
            'changes_requested',
            'approved',
            'scheduled',
            'published',
            'rejected',
            'failed'
        );
    end if;

    if not exists (
        select 1
        from pg_type t
        join pg_namespace n on n.oid = t.typnamespace
        where n.nspname = 'public' and t.typname = 'news_ai_status'
    ) then
        create type public.news_ai_status as enum (
            'not_started',
            'processing',
            'ready_for_review',
            'needs_review',
            'failed'
        );
    end if;

    if not exists (
        select 1
        from pg_type t
        join pg_namespace n on n.oid = t.typnamespace
        where n.nspname = 'public' and t.typname = 'editorial_role'
    ) then
        create type public.editorial_role as enum ('admin', 'editor', 'publisher');
    end if;

    if not exists (
        select 1
        from pg_type t
        join pg_namespace n on n.oid = t.typnamespace
        where n.nspname = 'public' and t.typname = 'article_version_origin'
    ) then
        create type public.article_version_origin as enum ('import', 'ai', 'editor');
    end if;

    if not exists (
        select 1
        from pg_type t
        join pg_namespace n on n.oid = t.typnamespace
        where n.nspname = 'public' and t.typname = 'news_source_group'
    ) then
        create type public.news_source_group as enum (
            'general_news',
            'business_finance',
            'official_government',
            'other'
        );
    end if;

    if not exists (
        select 1
        from pg_type t
        join pg_namespace n on n.oid = t.typnamespace
        where n.nspname = 'public' and t.typname = 'editorial_action_type'
    ) then
        create type public.editorial_action_type as enum (
            'scraped',
            'ai_processing_started',
            'ai_processed',
            'validation_failed',
            'edited',
            'preview_created',
            'changes_requested',
            'approved',
            'scheduled',
            'published',
            'unpublished',
            'rejected',
            'failed',
            'restored'
        );
    end if;
end
$$;

-- Every editorial child table uses news_articles.id as a UUID foreign key.
-- Fail early with an actionable message instead of producing a later, opaque
-- FK type error on installations created from an incompatible legacy schema.
do $$
begin
    if not exists (
        select 1
        from pg_attribute
        where attrelid = 'public.news_articles'::regclass
          and attname = 'id'
          and not attisdropped
          and atttypid = 'uuid'::regtype
    ) then
        raise exception 'news_articles.id must be uuid; migrate legacy IDs before applying editorial_workflow.sql';
    end if;
end
$$;

create table if not exists public.news_sources (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    domain text not null,
    base_url text,
    source_group public.news_source_group not null default 'other',
    feed_url text,
    adapter_key text,
    enabled boolean not null default true,
    scrape_interval_minutes integer not null default 60
        check (scrape_interval_minutes between 5 and 10080),
    last_scraped_at timestamptz,
    last_success_at timestamptz,
    last_error text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create unique index if not exists news_sources_domain_lower_key
    on public.news_sources (lower(domain));
create unique index if not exists news_sources_adapter_key_key
    on public.news_sources (adapter_key)
    where adapter_key is not null;

-- Initial publisher catalogue from the newsroom brief. Sources without a
-- verified automated adapter are deliberately paused; they can still be used
-- for manual imports without pretending that a crawler is healthy.
insert into public.news_sources as existing_source (
    name, domain, base_url, source_group, feed_url, adapter_key, enabled
)
values
    ('Daily Mirror', 'dailymirror.lk', 'https://www.dailymirror.lk/', 'general_news', null, 'daily-mirror-html', true),
    ('Ada Derana', 'adaderana.lk', 'https://www.adaderana.lk/', 'general_news', 'https://www.adaderana.lk/rss.php', 'ada-derana-rss', true),
    ('News First', 'newsfirst.lk', 'https://english.newsfirst.lk/', 'general_news', null, 'newsfirst-html', true),
    ('Hiru News', 'hirunews.lk', 'https://www.hirunews.lk/en/', 'general_news', null, 'hiru-html', true),
    ('Daily FT', 'ft.lk', 'https://www.ft.lk/', 'business_finance', 'https://www.ft.lk/rss/front-page/44', 'daily-ft-rss', true),
    ('EconomyNext', 'economynext.com', 'https://economynext.com/', 'business_finance', 'https://economynext.com/feed/', 'economynext-wp', true),
    ('SriLankaBiz', 'srilankabiz.lk', 'https://srilankabiz.lk/', 'business_finance', 'https://srilankabiz.lk/feed/', 'srilankabiz-wp', true),
    ('Lanka Business Online', 'lankabusinessonline.com', 'https://www.lankabusinessonline.com/', 'business_finance', 'https://www.lankabusinessonline.com/feed/', 'lbo-wp', true),
    ('Business Today', 'businesstoday.lk', 'https://businesstoday.lk/', 'business_finance', 'https://businesstoday.lk/feed/', 'business-today-wp', true),
    ('news.lk', 'news.lk', 'https://www.news.lk/', 'official_government', null, 'manual-news-lk', false),
    ('Civil Aviation Authority', 'caa.lk', 'https://www.caa.lk/', 'official_government', 'https://www.caa.lk/en/news?format=feed&type=rss', 'caa-rss', true),
    ('Sri Lanka Army', 'army.lk', 'https://www.army.lk/', 'official_government', null, 'army-html', true),
    ('The Morning', 'themorning.lk', 'https://www.themorning.lk/', 'general_news', null, 'the-morning-next-data', true),
    ('The Island', 'island.lk', 'https://island.lk/', 'general_news', 'https://island.lk/feed/', 'island-wp', true),
    ('Daily News', 'dailynews.lk', 'https://dailynews.lk/', 'general_news', 'https://dailynews.lk/feed/', 'daily-news-wp', true),
    ('Sri Lanka Mirror', 'srilankamirror.com', 'https://srilankamirror.com/', 'general_news', 'https://srilankamirror.com/feed/', 'sri-lanka-mirror-wp', true),
    ('Sunday Observer', 'sundayobserver.lk', 'https://www.sundayobserver.lk/', 'general_news', 'https://www.sundayobserver.lk/feed/', 'sunday-observer-wp', true),
    ('Xinhua', 'news.cn', 'https://english.news.cn/', 'general_news', null, 'xinhua-sri-lanka-html', true)
on conflict (lower(domain)) do update set
    name = excluded.name,
    base_url = excluded.base_url,
    source_group = excluded.source_group,
    feed_url = excluded.feed_url,
    adapter_key = excluded.adapter_key,
    enabled = case
        -- Applying a migration must never re-enable a source an editor has
        -- deliberately disabled. It may only promote an old manual seed row.
        when existing_source.adapter_key like 'manual-%'
            then excluded.enabled
        else existing_source.enabled
    end;

create table if not exists public.categories (
    id uuid primary key default gen_random_uuid(),
    slug text not null unique
        check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
    display_name text not null unique,
    description text,
    display_order smallint not null default 0
        check (display_order >= 0),
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

insert into public.categories (slug, display_name, display_order)
values
    ('business-news', 'Business News', 10),
    ('interviews-appointments', 'Interviews & Appointments', 20),
    ('money', 'Money', 30),
    ('technology', 'Technology', 40),
    ('travel-tourism', 'Travel & Tourism', 50),
    ('luxury-living', 'Luxury Living', 60)
on conflict (slug) do update
set display_name = excluded.display_name,
    display_order = excluded.display_order;

create table if not exists public.admin_profiles (
    user_id uuid primary key references auth.users(id) on delete cascade,
    display_name text not null default '',
    role public.editorial_role not null default 'editor',
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- source_id already stores the publisher-specific identifier. source_ref_id is
-- deliberately named differently and points at the normalized publisher row.
alter table public.news_articles
    add column if not exists source_ref_id uuid;
alter table public.news_articles
    add column if not exists category_id uuid;
alter table public.news_articles
    add column if not exists workflow_status public.news_workflow_status
        not null default 'scraped';
alter table public.news_articles
    add column if not exists ai_status public.news_ai_status
        not null default 'not_started';
alter table public.news_articles
    add column if not exists original_title text;
alter table public.news_articles
    add column if not exists original_summary text;
alter table public.news_articles
    add column if not exists original_content text;
alter table public.news_articles
    add column if not exists source_published_at timestamptz;
alter table public.news_articles
    add column if not exists content_hash text;
alter table public.news_articles
    add column if not exists reviewed_by uuid;
alter table public.news_articles
    add column if not exists reviewed_at timestamptz;
alter table public.news_articles
    add column if not exists approved_by uuid;
alter table public.news_articles
    add column if not exists approved_at timestamptz;
alter table public.news_articles
    add column if not exists scheduled_for timestamptz;
alter table public.news_articles
    add column if not exists site_published_at timestamptz;
alter table public.news_articles
    add column if not exists rejection_reason text;

do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conrelid = 'public.news_articles'::regclass
          and conname = 'news_articles_source_ref_id_fkey'
    ) then
        alter table public.news_articles
            add constraint news_articles_source_ref_id_fkey
            foreign key (source_ref_id) references public.news_sources(id)
            on delete set null;
    end if;

    if not exists (
        select 1 from pg_constraint
        where conrelid = 'public.news_articles'::regclass
          and conname = 'news_articles_category_id_fkey'
    ) then
        alter table public.news_articles
            add constraint news_articles_category_id_fkey
            foreign key (category_id) references public.categories(id)
            on delete set null;
    end if;

    if not exists (
        select 1 from pg_constraint
        where conrelid = 'public.news_articles'::regclass
          and conname = 'news_articles_reviewed_by_fkey'
    ) then
        alter table public.news_articles
            add constraint news_articles_reviewed_by_fkey
            foreign key (reviewed_by) references auth.users(id)
            on delete set null;
    end if;

    if not exists (
        select 1 from pg_constraint
        where conrelid = 'public.news_articles'::regclass
          and conname = 'news_articles_approved_by_fkey'
    ) then
        alter table public.news_articles
            add constraint news_articles_approved_by_fkey
            foreign key (approved_by) references auth.users(id)
            on delete set null;
    end if;
end
$$;

create table if not exists public.article_versions (
    id uuid primary key default gen_random_uuid(),
    article_id uuid not null references public.news_articles(id) on delete cascade,
    version_number integer not null check (version_number > 0),
    origin public.article_version_origin not null,
    headline text not null,
    summary text,
    content text not null default '',
    category_id uuid references public.categories(id) on delete set null,
    tags jsonb not null default '[]'::jsonb
        check (jsonb_typeof(tags) = 'array'),
    language text not null default 'en',
    ai_model text,
    prompt_version text,
    ai_warnings jsonb not null default '[]'::jsonb
        check (jsonb_typeof(ai_warnings) = 'array'),
    validation_errors jsonb not null default '[]'::jsonb
        check (jsonb_typeof(validation_errors) = 'array'),
    requires_human_review boolean not null default false,
    change_note text,
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    constraint article_versions_article_version_key
        unique (article_id, version_number),
    constraint article_versions_article_id_id_key
        unique (article_id, id)
);

alter table public.news_articles
    add column if not exists current_version_id uuid;
alter table public.news_articles
    add column if not exists published_version_id uuid;

do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conrelid = 'public.news_articles'::regclass
          and conname = 'news_articles_current_version_id_fkey'
    ) then
        alter table public.news_articles
            add constraint news_articles_current_version_id_fkey
            foreign key (current_version_id) references public.article_versions(id)
            on delete set null;
    end if;

    if not exists (
        select 1 from pg_constraint
        where conrelid = 'public.news_articles'::regclass
          and conname = 'news_articles_published_version_id_fkey'
    ) then
        alter table public.news_articles
            add constraint news_articles_published_version_id_fkey
            foreign key (published_version_id) references public.article_versions(id)
            on delete set null;
    end if;

    if not exists (
        select 1 from pg_constraint
        where conrelid = 'public.news_articles'::regclass
          and conname = 'news_articles_published_fields_check'
    ) then
        alter table public.news_articles
            add constraint news_articles_published_fields_check check (
                workflow_status <> 'published'
                or (
                    published_version_id is not null
                    and site_published_at is not null
                )
            ) not valid;
    end if;

    if not exists (
        select 1 from pg_constraint
        where conrelid = 'public.news_articles'::regclass
          and conname = 'news_articles_scheduled_fields_check'
    ) then
        alter table public.news_articles
            add constraint news_articles_scheduled_fields_check check (
                workflow_status <> 'scheduled'
                or (current_version_id is not null and scheduled_for is not null)
            ) not valid;
    end if;
end
$$;

create table if not exists public.editorial_actions (
    id uuid primary key default gen_random_uuid(),
    article_id uuid not null references public.news_articles(id) on delete cascade,
    action public.editorial_action_type not null,
    from_status public.news_workflow_status,
    to_status public.news_workflow_status,
    note text,
    metadata jsonb not null default '{}'::jsonb
        check (jsonb_typeof(metadata) = 'object'),
    performed_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now()
);

create table if not exists public.home_top_news_slots (
    slot_number smallint primary key check (slot_number between 1 and 10),
    article_id uuid unique references public.news_articles(id) on delete set null,
    starts_at timestamptz,
    ends_at timestamptz,
    updated_by uuid references auth.users(id) on delete set null,
    updated_at timestamptz not null default now(),
    constraint home_top_news_slots_date_order_check check (
        ends_at is null or starts_at is null or ends_at > starts_at
    )
);

insert into public.home_top_news_slots (slot_number)
select slot_number
from generate_series(1, 10) as slots(slot_number)
on conflict (slot_number) do nothing;

-- Replace the complete ranking inside one database transaction. The Express
-- service is the only caller; browser roles receive no execute permission.
create or replace function public.replace_home_top_news(
    selected_article_ids uuid[],
    actor_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    ids uuid[] := coalesce(selected_article_ids, array[]::uuid[]);
    position integer;
begin
    if cardinality(ids) > 10 then
        raise exception 'Top News supports no more than ten articles'
            using errcode = '22023';
    end if;

    if (
        select count(*) from unnest(ids) as selected(article_id)
    ) <> (
        select count(distinct article_id) from unnest(ids) as selected(article_id)
    ) then
        raise exception 'Top News article IDs must be unique'
            using errcode = '22023';
    end if;

    if exists (
        select 1
        from unnest(ids) as selected(article_id)
        left join public.news_articles as article on article.id = selected.article_id
        where article.id is null
           or article.workflow_status <> 'published'
           or article.site_published_at is null
           or article.site_published_at > now()
    ) then
        raise exception 'Top News accepts live published articles only'
            using errcode = '23514';
    end if;

    perform 1
    from public.home_top_news_slots
    order by slot_number
    for update;

    update public.home_top_news_slots
    set article_id = null,
        starts_at = null,
        ends_at = null,
        updated_by = actor_id,
        updated_at = now();

    if cardinality(ids) > 0 then
        for position in 1..cardinality(ids) loop
            update public.home_top_news_slots
            set article_id = ids[position],
                updated_by = actor_id,
                updated_at = now()
            where slot_number = position;
        end loop;
    end if;
end
$$;

-- Only a SHA-256/HMAC digest is stored. The raw preview token must be returned
-- once by the backend and must never be written to this table or application logs.
create table if not exists public.article_preview_tokens (
    id uuid primary key default gen_random_uuid(),
    article_id uuid not null references public.news_articles(id) on delete cascade,
    token_hash text not null unique
        check (char_length(token_hash) between 32 and 256),
    expires_at timestamptz not null,
    max_uses integer check (max_uses is null or max_uses > 0),
    use_count integer not null default 0 check (use_count >= 0),
    last_used_at timestamptz,
    revoked_at timestamptz,
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    constraint article_preview_tokens_expiry_check check (expires_at > created_at),
    constraint article_preview_tokens_use_limit_check check (
        max_uses is null or use_count <= max_uses
    )
);

create index if not exists news_articles_workflow_queue_idx
    on public.news_articles (workflow_status, scraped_at desc);
create index if not exists news_articles_publication_idx
    on public.news_articles (site_published_at desc)
    where workflow_status = 'published';
create index if not exists news_articles_category_publication_idx
    on public.news_articles (category_id, site_published_at desc)
    where workflow_status = 'published';
create index if not exists news_articles_source_ref_idx
    on public.news_articles (source_ref_id);
create index if not exists news_articles_ai_status_idx
    on public.news_articles (ai_status, scraped_at desc);
create unique index if not exists news_articles_published_slug_key
    on public.news_articles (slug)
    where workflow_status = 'published' and slug is not null;
create index if not exists article_versions_article_created_idx
    on public.article_versions (article_id, created_at desc);
create index if not exists editorial_actions_article_created_idx
    on public.editorial_actions (article_id, created_at desc);
create index if not exists article_preview_tokens_lookup_idx
    on public.article_preview_tokens (token_hash, expires_at)
    where revoked_at is null;

-- Normalize the navigation labels without making the old free-text `category`
-- column part of the new relational contract.
create or replace function public.editorial_category_slug(category_name text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
    select case lower(trim(category_name))
        when 'business news' then 'business-news'
        when 'business' then 'business-news'
        when 'business & corporate' then 'business-news'
        when 'business and corporate' then 'business-news'
        when 'corporate' then 'business-news'
        when 'front page' then 'business-news'
        when 'top story' then 'business-news'
        when 'governance & policy' then 'business-news'
        when 'governance and policy' then 'business-news'
        when 'opinion & issues' then 'business-news'
        when 'opinion and issues' then 'business-news'
        when 'esg & leadership' then 'business-news'
        when 'esg and leadership' then 'business-news'
        when 'sustainability' then 'business-news'
        when 'interviews and appoints' then 'interviews-appointments'
        when 'interviews and appointments' then 'interviews-appointments'
        when 'interviews & appointments' then 'interviews-appointments'
        when 'appointments' then 'interviews-appointments'
        when 'interviews' then 'interviews-appointments'
        when 'money' then 'money'
        when 'economy & finance' then 'money'
        when 'economy and finance' then 'money'
        when 'economy' then 'money'
        when 'financial services' then 'money'
        when 'finance' then 'money'
        when 'markets' then 'money'
        when 'technology' then 'technology'
        when 'travel and tourism' then 'travel-tourism'
        when 'travel & tourism' then 'travel-tourism'
        when 'tourism' then 'travel-tourism'
        when 'travel' then 'travel-tourism'
        when 'luxury living' then 'luxury-living'
        else trim(both '-' from regexp_replace(
            lower(trim(category_name)), '[^a-z0-9]+', '-', 'g'
        ))
    end
$$;

update public.news_articles as article
set original_title = coalesce(
        article.original_title,
        nullif(article.title, ''),
        article.headline_en
    ),
    original_summary = coalesce(
        article.original_summary,
        nullif(article.summary, ''),
        article.summary_en
    ),
    original_content = coalesce(article.original_content, article.content),
    source_published_at = coalesce(
        article.source_published_at,
        article.published_at
    )
where article.original_title is null
   or article.original_summary is null
   or article.original_content is null
   or article.source_published_at is null;

update public.news_articles as article
set slug = coalesce(nullif(trim(both '-' from substring(
        regexp_replace(lower(coalesce(nullif(article.title, ''), article.headline_en, 'news-update')),
            '[^a-z0-9]+', '-', 'g')
        from 1 for 80
    )), ''), 'news-update') || '-' || left(replace(article.id::text, '-', ''), 7)
where article.slug is null or btrim(article.slug) = '';

update public.news_articles as article
set content_hash = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    coalesce(article.original_title, '') || E'\n' ||
    coalesce(article.original_summary, '') || E'\n' ||
    coalesce(article.original_content, ''),
    'UTF8'
)), 'hex')
where article.content_hash is null;

update public.news_articles as article
set category_id = category.id
from public.categories as category
where article.category_id is null
  and article.category is not null
  and category.slug = public.editorial_category_slug(article.category);

update public.news_articles as article
set source_ref_id = source.id
from public.news_sources as source
where article.source_ref_id is null
  and coalesce(article.source_url, article.canonical_url) is not null
  and (
      lower(regexp_replace(
          split_part(split_part(coalesce(article.source_url, article.canonical_url), '://', 2), '/', 1),
          '^www\.', ''
      )) = lower(source.domain)
      or lower(regexp_replace(
          split_part(split_part(coalesce(article.source_url, article.canonical_url), '://', 2), '/', 1),
          '^www\.', ''
      )) like '%.' || lower(source.domain)
  );

create or replace function public.initialize_news_article_editorial_fields()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
    if new.slug is null or btrim(new.slug) = '' then
        new.slug := coalesce(nullif(trim(both '-' from substring(
            regexp_replace(lower(coalesce(nullif(new.title, ''), new.headline_en, 'news-update')),
                '[^a-z0-9]+', '-', 'g')
            from 1 for 80
        )), ''), 'news-update') || '-' || left(replace(new.id::text, '-', ''), 7);
    end if;
    if new.original_title is null then
        new.original_title := coalesce(nullif(new.title, ''), new.headline_en);
    end if;
    if new.original_summary is null then
        new.original_summary := coalesce(nullif(new.summary, ''), new.summary_en);
    end if;
    if new.original_content is null then
        new.original_content := new.content;
    end if;
    if new.content_hash is null then
        new.content_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
            coalesce(new.original_title, '') || E'\n' ||
            coalesce(new.original_summary, '') || E'\n' ||
            coalesce(new.original_content, ''),
            'UTF8'
        )), 'hex');
    end if;
    if new.source_published_at is null then
        -- The legacy published_at column remains the publisher/source date.
        new.source_published_at := new.published_at;
    end if;
    if new.source_ref_id is null and coalesce(new.source_url, new.canonical_url) is not null then
        select source.id
        into new.source_ref_id
        from public.news_sources as source
        where lower(regexp_replace(
                split_part(split_part(coalesce(new.source_url, new.canonical_url), '://', 2), '/', 1),
                '^www\.', ''
              )) = lower(source.domain)
           or lower(regexp_replace(
                split_part(split_part(coalesce(new.source_url, new.canonical_url), '://', 2), '/', 1),
                '^www\.', ''
              )) like '%.' || lower(source.domain)
        order by length(source.domain) desc
        limit 1;
    end if;
    if new.category_id is null and new.category is not null then
        select category.id
        into new.category_id
        from public.categories as category
        where category.slug = public.editorial_category_slug(new.category)
        limit 1;
    end if;
    return new;
end;
$$;

drop trigger if exists initialize_news_article_editorial_fields
    on public.news_articles;
create trigger initialize_news_article_editorial_fields
before insert or update of title, headline_en, summary, summary_en, content, slug,
    published_at, category, original_title, original_summary, original_content,
    source_published_at, category_id, source_url, canonical_url, source_ref_id,
    content_hash
on public.news_articles
for each row execute function public.initialize_news_article_editorial_fields();

-- A source registry edit (including its enabled toggle) is not a collection.
-- Advance health timestamps only when a successfully delivered article has a
-- newer scraper timestamp. The max/strict-newer guard is important because the
-- pipeline also re-upserts historical merged feed rows on every run.
create or replace function public.record_news_source_collection_success()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if new.source_ref_id is not null and new.scraped_at is not null then
        update public.news_sources as source
        set last_scraped_at = new.scraped_at,
            last_success_at = new.scraped_at,
            last_error = null
        where source.id = new.source_ref_id
          and (
              source.last_scraped_at is null
              or new.scraped_at > source.last_scraped_at
          );
    end if;
    return new;
end;
$$;

revoke all on function public.record_news_source_collection_success() from public;

drop trigger if exists record_news_source_collection_success
    on public.news_articles;
create trigger record_news_source_collection_success
after insert or update of scraped_at, source_ref_id
on public.news_articles
for each row execute function public.record_news_source_collection_success();

create or replace function public.assign_article_version_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    -- Serialize numbering per article so two editor saves cannot receive the
    -- same version number.
    perform pg_advisory_xact_lock(hashtextextended(new.article_id::text, 0));
    if new.version_number is null or new.version_number <= 0 then
        select coalesce(max(version.version_number), 0) + 1
        into new.version_number
        from public.article_versions as version
        where version.article_id = new.article_id;
    end if;
    return new;
end;
$$;

revoke all on function public.assign_article_version_number() from public;

drop trigger if exists assign_article_version_number on public.article_versions;
create trigger assign_article_version_number
before insert on public.article_versions
for each row execute function public.assign_article_version_number();

create or replace function public.validate_news_article_version_links()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if new.current_version_id is not null and not exists (
        select 1
        from public.article_versions as version
        where version.id = new.current_version_id
          and version.article_id = new.id
    ) then
        raise exception 'current_version_id must belong to the same news article';
    end if;

    if new.published_version_id is not null and not exists (
        select 1
        from public.article_versions as version
        where version.id = new.published_version_id
          and version.article_id = new.id
    ) then
        raise exception 'published_version_id must belong to the same news article';
    end if;
    return new;
end;
$$;

revoke all on function public.validate_news_article_version_links() from public;

drop trigger if exists validate_news_article_version_links
    on public.news_articles;
create trigger validate_news_article_version_links
before insert or update of current_version_id, published_version_id
on public.news_articles
for each row execute function public.validate_news_article_version_links();

create or replace function public.workflow_action_for_status(
    status_value public.news_workflow_status
)
returns public.editorial_action_type
language sql
immutable
strict
set search_path = ''
as $$
    select case status_value
        when 'scraped' then 'scraped'::public.editorial_action_type
        when 'ai_processing' then 'ai_processing_started'::public.editorial_action_type
        when 'pending_review' then 'ai_processed'::public.editorial_action_type
        when 'changes_requested' then 'changes_requested'::public.editorial_action_type
        when 'approved' then 'approved'::public.editorial_action_type
        when 'scheduled' then 'scheduled'::public.editorial_action_type
        when 'published' then 'published'::public.editorial_action_type
        when 'rejected' then 'rejected'::public.editorial_action_type
        when 'failed' then 'failed'::public.editorial_action_type
    end
$$;

-- Give pre-migration rows an audit baseline without duplicating history when
-- this migration is rerun.
insert into public.editorial_actions (
    article_id,
    action,
    from_status,
    to_status,
    metadata
)
select
    article.id,
    public.workflow_action_for_status(article.workflow_status),
    null,
    article.workflow_status,
    jsonb_build_object('recorded_by', 'migration_backfill')
from public.news_articles as article
where not exists (
    select 1
    from public.editorial_actions as action
    where action.article_id = article.id
);

create or replace function public.audit_news_article_workflow_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    previous_status public.news_workflow_status;
begin
    if tg_op = 'UPDATE' then
        previous_status := old.workflow_status;
        if new.workflow_status is not distinct from old.workflow_status then
            return new;
        end if;
    end if;

    insert into public.editorial_actions (
        article_id,
        action,
        from_status,
        to_status,
        performed_by,
        metadata
    ) values (
        new.id,
        public.workflow_action_for_status(new.workflow_status),
        previous_status,
        new.workflow_status,
        auth.uid(),
        jsonb_build_object('recorded_by', 'workflow_trigger')
    );
    return new;
end;
$$;

revoke all on function public.audit_news_article_workflow_change() from public;

drop trigger if exists audit_news_article_workflow_change
    on public.news_articles;
create trigger audit_news_article_workflow_change
after insert or update of workflow_status on public.news_articles
for each row execute function public.audit_news_article_workflow_change();

create or replace function public.validate_top_news_article()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    article_status public.news_workflow_status;
    article_published_at timestamptz;
begin
    if new.article_id is null then
        return new;
    end if;

    select article.workflow_status, article.site_published_at
    into article_status, article_published_at
    from public.news_articles as article
    where article.id = new.article_id;

    if article_status is distinct from 'published'
       or article_published_at is null then
        raise exception 'Top News slots accept published articles only';
    end if;
    return new;
end;
$$;

revoke all on function public.validate_top_news_article() from public;

drop trigger if exists validate_top_news_article
    on public.home_top_news_slots;
create trigger validate_top_news_article
before insert or update of article_id on public.home_top_news_slots
for each row execute function public.validate_top_news_article();

create or replace function public.set_editorial_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists set_news_sources_updated_at on public.news_sources;
create trigger set_news_sources_updated_at
before update on public.news_sources
for each row execute function public.set_editorial_updated_at();

drop trigger if exists set_categories_updated_at on public.categories;
create trigger set_categories_updated_at
before update on public.categories
for each row execute function public.set_editorial_updated_at();

drop trigger if exists set_admin_profiles_updated_at on public.admin_profiles;
create trigger set_admin_profiles_updated_at
before update on public.admin_profiles
for each row execute function public.set_editorial_updated_at();

drop trigger if exists set_home_top_news_slots_updated_at
    on public.home_top_news_slots;
create trigger set_home_top_news_slots_updated_at
before update on public.home_top_news_slots
for each row execute function public.set_editorial_updated_at();

-- SECURITY DEFINER avoids recursive admin_profiles RLS checks. It returns true
-- only for an active Supabase Auth user explicitly provisioned by service_role.
create or replace function public.has_editorial_role(
    allowed_roles public.editorial_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.admin_profiles as profile
        where profile.user_id = auth.uid()
          and profile.is_active
          and profile.role = any(allowed_roles)
    )
$$;

create or replace function public.is_editorial_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select public.has_editorial_role(
        array['admin', 'editor', 'publisher']::public.editorial_role[]
    )
$$;

revoke all on function public.has_editorial_role(public.editorial_role[])
    from public, anon;
revoke all on function public.is_editorial_member()
    from public, anon;
grant execute on function public.has_editorial_role(public.editorial_role[])
    to authenticated, service_role;
grant execute on function public.is_editorial_member()
    to authenticated, service_role;

alter table public.news_sources enable row level security;
alter table public.categories enable row level security;
alter table public.admin_profiles enable row level security;
alter table public.news_articles enable row level security;
alter table public.article_versions enable row level security;
alter table public.editorial_actions enable row level security;
alter table public.home_top_news_slots enable row level security;
alter table public.article_preview_tokens enable row level security;

-- Public catalogue data.
drop policy if exists news_sources_public_read on public.news_sources;
create policy news_sources_public_read
on public.news_sources for select
to anon, authenticated
using (enabled);

drop policy if exists news_sources_editorial_read on public.news_sources;
create policy news_sources_editorial_read
on public.news_sources for select
to authenticated
using (public.is_editorial_member());

drop policy if exists categories_public_read on public.categories;
create policy categories_public_read
on public.categories for select
to anon, authenticated
using (is_active);

drop policy if exists categories_editorial_read on public.categories;
create policy categories_editorial_read
on public.categories for select
to authenticated
using (public.is_editorial_member());

-- Users may inspect their own role; active admins may inspect all profiles.
drop policy if exists admin_profiles_self_read on public.admin_profiles;
create policy admin_profiles_self_read
on public.admin_profiles for select
to authenticated
using (
    user_id = auth.uid()
    or public.has_editorial_role(array['admin']::public.editorial_role[])
);

-- This restrictive visibility guard is intentional. Even if the project had
-- an older permissive SELECT policy, anonymous/non-editor users remain capped
-- at live published rows. Editorial members can inspect the review queue.
drop policy if exists news_articles_public_read on public.news_articles;
create policy news_articles_public_read
on public.news_articles for select
to anon, authenticated
using (
    workflow_status = 'published'
    and site_published_at is not null
    and site_published_at <= now()
);

drop policy if exists news_articles_editorial_read on public.news_articles;
create policy news_articles_editorial_read
on public.news_articles for select
to authenticated
using (public.is_editorial_member());

drop policy if exists news_articles_anon_visibility_guard
    on public.news_articles;
create policy news_articles_anon_visibility_guard
on public.news_articles as restrictive for select
to anon
using (
    workflow_status = 'published'
    and site_published_at is not null
    and site_published_at <= now()
);

drop policy if exists news_articles_authenticated_visibility_guard
    on public.news_articles;
create policy news_articles_authenticated_visibility_guard
on public.news_articles as restrictive for select
to authenticated
using (
    (
        workflow_status = 'published'
        and site_published_at is not null
        and site_published_at <= now()
    )
    or public.is_editorial_member()
);

drop policy if exists article_versions_public_read on public.article_versions;
create policy article_versions_public_read
on public.article_versions for select
to anon, authenticated
using (
    exists (
        select 1
        from public.news_articles as article
        where article.id = article_versions.article_id
          and article.published_version_id = article_versions.id
          and article.workflow_status = 'published'
          and article.site_published_at is not null
          and article.site_published_at <= now()
    )
);

drop policy if exists article_versions_editorial_read on public.article_versions;
create policy article_versions_editorial_read
on public.article_versions for select
to authenticated
using (public.is_editorial_member());

drop policy if exists editorial_actions_editorial_read on public.editorial_actions;
create policy editorial_actions_editorial_read
on public.editorial_actions for select
to authenticated
using (public.is_editorial_member());

drop policy if exists home_top_news_slots_public_read
    on public.home_top_news_slots;
create policy home_top_news_slots_public_read
on public.home_top_news_slots for select
to anon, authenticated
using (
    article_id is not null
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at > now())
    and exists (
        select 1
        from public.news_articles as article
        where article.id = home_top_news_slots.article_id
          and article.workflow_status = 'published'
          and article.site_published_at is not null
          and article.site_published_at <= now()
    )
);

drop policy if exists home_top_news_slots_editorial_read
    on public.home_top_news_slots;
create policy home_top_news_slots_editorial_read
on public.home_top_news_slots for select
to authenticated
using (public.is_editorial_member());

drop policy if exists article_preview_tokens_editorial_read
    on public.article_preview_tokens;
create policy article_preview_tokens_editorial_read
on public.article_preview_tokens for select
to authenticated
using (public.is_editorial_member());

-- Stable read models keep the React applications independent of storage
-- details. security_invoker makes every underlying RLS policy and grant apply
-- as the requesting user instead of silently bypassing them as the view owner.
create or replace view public.published_articles
with (security_invoker = true, security_barrier = true)
as
select
    article.id,
    article.slug,
    version.headline,
    version.summary,
    version.content,
    coalesce(version.category_id, article.category_id) as category_id,
    category.slug as category_slug,
    category.display_name as category_name,
    version.tags,
    version.language,
    article.author,
    coalesce(source.name, article.source) as source_name,
    article.source_url,
    article.canonical_url,
    article.source_published_at,
    article.site_published_at,
    article.image_url,
    article.local_image_path,
    article.image_alt,
    article.image_mime_type,
    article.image_width,
    article.image_height,
    article.views
from public.news_articles as article
join public.article_versions as version
  on version.id = article.published_version_id
 and version.article_id = article.id
left join public.categories as category
  on category.id = coalesce(version.category_id, article.category_id)
left join public.news_sources as source
  on source.id = article.source_ref_id
where article.workflow_status = 'published'
  and article.site_published_at is not null
  and article.site_published_at <= now();

create or replace view public.published_top_news
with (security_invoker = true, security_barrier = true)
as
select
    slot.slot_number,
    slot.starts_at as featured_from,
    slot.ends_at as featured_until,
    article.*
from public.home_top_news_slots as slot
join public.published_articles as article
  on article.id = slot.article_id
where (slot.starts_at is null or slot.starts_at <= now())
  and (slot.ends_at is null or slot.ends_at > now())
order by slot.slot_number;

create or replace view public.editorial_article_overview
with (security_invoker = true, security_barrier = true)
as
select
    article.id,
    article.source_ref_id,
    article.source_id as publisher_article_id,
    article.canonical_url,
    article.source_url,
    article.slug,
    article.workflow_status,
    article.ai_status,
    article.original_title,
    article.original_summary,
    article.original_content,
    article.source_published_at,
    article.scraped_at,
    article.content_hash,
    article.category_id,
    category.slug as category_slug,
    category.display_name as category_name,
    article.current_version_id,
    current_version.version_number as current_version_number,
    current_version.origin as current_version_origin,
    current_version.headline as current_headline,
    current_version.summary as current_summary,
    current_version.content as current_content,
    current_version.tags as current_tags,
    current_version.requires_human_review,
    current_version.ai_warnings,
    current_version.validation_errors,
    article.published_version_id,
    article.reviewed_by,
    article.reviewed_at,
    article.approved_by,
    article.approved_at,
    article.scheduled_for,
    article.site_published_at,
    article.rejection_reason,
    article.author,
    coalesce(source.name, article.source) as source_name,
    article.image_url,
    article.local_image_path,
    article.image_alt,
    article.image_status,
    article.created_at,
    article.updated_at
from public.news_articles as article
left join public.article_versions as current_version
  on current_version.id = article.current_version_id
 and current_version.article_id = article.id
left join public.categories as category
  on category.id = coalesce(current_version.category_id, article.category_id)
left join public.news_sources as source
  on source.id = article.source_ref_id;

-- Browser sessions are read-only at the database layer. All mutations go
-- through the authenticated Express API, which applies role/transition rules
-- and uses the server-side service role. This also prevents a client from
-- changing workflow_status directly in DevTools.
revoke select on public.news_sources, public.categories, public.admin_profiles,
    public.news_articles, public.article_versions, public.editorial_actions,
    public.home_top_news_slots, public.article_preview_tokens
    from public, anon, authenticated;
revoke all on public.published_articles, public.published_top_news,
    public.editorial_article_overview
    from public, anon, authenticated;
revoke insert, update, delete, truncate, references, trigger
    on public.news_articles from public, anon, authenticated;
revoke insert, update, delete, truncate, references, trigger
    on public.news_sources, public.categories, public.admin_profiles,
       public.article_versions, public.editorial_actions,
       public.home_top_news_slots, public.article_preview_tokens
    from public, anon, authenticated;

-- Grant only the base columns required by the security-invoker public view.
-- In particular, anon cannot query original_* text, editorial user IDs,
-- validation details, prompt metadata, source errors, or preview digests.
grant select (id, name, enabled)
    on public.news_sources to anon, authenticated;
grant select (
    id, slug, display_name, description, display_order, is_active
)
    on public.categories to anon, authenticated;
grant select (
    id, slug, author, source, source_ref_id, category_id, source_url,
    canonical_url, workflow_status, source_published_at, site_published_at,
    published_version_id, image_url, local_image_path, image_alt,
    image_mime_type, image_width, image_height, views
)
    on public.news_articles to anon, authenticated;
grant select (
    id, article_id, headline, summary, content, category_id, tags, language
)
    on public.article_versions to anon, authenticated;
grant select (slot_number, article_id, starts_at, ends_at)
    on public.home_top_news_slots to anon, authenticated;
grant select on public.published_articles, public.published_top_news
    to anon, authenticated;
grant select on public.admin_profiles, public.editorial_actions to authenticated;

grant all on public.news_sources, public.categories, public.admin_profiles,
    public.news_articles, public.article_versions, public.editorial_actions,
    public.home_top_news_slots, public.article_preview_tokens
    to service_role;
revoke all on function public.replace_home_top_news(uuid[], uuid)
    from public, anon, authenticated;
grant execute on function public.replace_home_top_news(uuid[], uuid)
    to service_role;
grant select on public.published_articles, public.published_top_news,
    public.editorial_article_overview to service_role;

comment on column public.news_articles.published_at is
    'Legacy scraper field: the date/time reported by the original publisher.';
comment on column public.news_articles.site_published_at is
    'The date/time an approved version becomes visible on this website.';
comment on column public.news_articles.source_ref_id is
    'FK to news_sources; source_id remains the publisher-specific article ID.';
comment on column public.news_articles.current_version_id is
    'Latest AI/editor draft shown in the admin editor.';
comment on column public.news_articles.published_version_id is
    'Immutable approved version rendered by the public website.';
comment on table public.article_versions is
    'Immutable AI/editor snapshots. Editing creates a new numbered version.';
comment on table public.article_preview_tokens is
    'Short-lived preview token digests; raw bearer tokens are never persisted.';
comment on table public.home_top_news_slots is
    'The ten explicitly ordered Top News positions on the public home page.';
comment on view public.published_articles is
    'Public RLS-aware projection resolving each live article to its approved immutable version.';
comment on view public.published_top_news is
    'Public RLS-aware projection of the active, explicitly ordered Home Top News slots.';
comment on view public.editorial_article_overview is
    'Editorial-only RLS-aware projection resolving each article to its current working version.';

-- Make the new tables/views visible to Supabase REST immediately after this
-- migration completes, without requiring a Dashboard schema-cache restart.
notify pgrst, 'reload schema';
