-- Nagrik: civic issue reporting platform
-- Run this in the Supabase SQL editor to set up the schema.

-- Enable extensions
create extension if not exists "cube";
create extension if not exists "earthdistance"; -- provides ll_to_earth for the reports GiST index

-- ============ USERS ============
-- Supabase auth.users already exists; we extend with a profile table.
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  -- moderator flag: allows resolving/rejecting reports filed by others
  is_moderator boolean default false,
  created_at timestamptz default now()
);

-- Existing installs (table already created without the flag):
alter table profiles add column if not exists is_moderator boolean default false;

-- ============ MLAs / CONSTITUENCIES ============
create table if not exists mlas (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  party text,
  constituency text not null,
  ward text,
  contact_email text,
  contact_phone text,
  photo_url text,
  -- rough boundary as a polygon, or fall back to a simple lat/lng + radius for MVP
  center_lat double precision,
  center_lng double precision,
  created_at timestamptz default now()
);

-- One row per constituency; unique so upserts (seed-mlas.js) can match on it.
create unique index if not exists idx_mlas_constituency on mlas (constituency);


-- ============ REPORTS ============
create type report_category as enum (
  'pothole', 'garbage', 'streetlight', 'water_supply', 'drainage',
  'road_damage', 'illegal_construction', 'other'
);

create type report_status as enum ('pending', 'acknowledged', 'resolved', 'rejected');

create table if not exists reports (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete set null,
  category report_category not null,
  description text,
  photo_url text not null,

  lat double precision not null,
  lng double precision not null,
  ward text,
  constituency text,
  mla_id uuid references mlas(id),

  severity_score numeric(4,2) default 0,   -- 0-10, from AI vision classification
  duplicate_count int default 0,            -- how many similar reports nearby
  priority_score numeric(5,2) default 0,    -- computed composite score, drives the bar

  status report_status default 'pending',
  complaint_text text,                      -- AI-generated official complaint draft
  complaint_submitted boolean default false,

  ig_post_id text,                          -- Instagram post id once posted
  ig_last_posted_at timestamptz,

  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_checked_at timestamptz default now(),
  resolved_at timestamptz
);

create index if not exists idx_reports_status on reports (status);
create index if not exists idx_reports_priority on reports (priority_score desc);
create index if not exists idx_reports_category on reports (category);
create index if not exists idx_reports_location on reports using gist (
  ll_to_earth(lat, lng)
);

-- ============ DUPLICATE LINKS (which reports were merged/counted together) ============
create table if not exists report_duplicates (
  id uuid primary key default uuid_generate_v4(),
  original_report_id uuid references reports(id) on delete cascade,
  duplicate_report_id uuid references reports(id) on delete cascade,
  created_at timestamptz default now(),
  unique (original_report_id, duplicate_report_id)
);

-- ============ ROW LEVEL SECURITY ============
alter table reports enable row level security;
alter table profiles enable row level security;

-- Anyone can read reports (public feed)
create policy "Public read access to reports"
  on reports for select
  using (true);

-- Only authenticated users can insert their own reports
create policy "Users can insert own reports"
  on reports for insert
  with check (auth.uid() = user_id);

-- Only the reporting user (or service role) can update their own report status
create policy "Users can update own reports"
  on reports for update
  using (auth.uid() = user_id);

create policy "Users manage own profile"
  on profiles for all
  using (auth.uid() = id);
