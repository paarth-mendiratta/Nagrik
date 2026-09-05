-- Migration: report_comments table (for databases created before comments existed).
-- Paste into the Supabase SQL editor and run as ONE block. Fully idempotent:
-- table/index use IF NOT EXISTS and each policy is dropped before creation,
-- so re-running is safe.
--
-- NOTE: run the ENTIRE block in one pass. If only part of it executes you'll
-- hit "relation report_comments does not exist" on the index/policy lines.

create table if not exists report_comments (
  id uuid primary key default uuid_generate_v4(),
  report_id uuid references reports(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  body text not null check (char_length(body) <= 500),
  is_hidden boolean default false,
  created_at timestamptz default now()
);

create index if not exists idx_comments_report on report_comments (report_id, created_at);

alter table report_comments enable row level security;

drop policy if exists "Public read non-hidden comments" on report_comments;
create policy "Public read non-hidden comments"
  on report_comments for select
  using (is_hidden = false);

drop policy if exists "Authenticated users can insert comments" on report_comments;
create policy "Authenticated users can insert comments"
  on report_comments for insert
  with check (auth.uid() = user_id);

drop policy if exists "Owner or moderator can update comments" on report_comments;
create policy "Owner or moderator can update comments"
  on report_comments for update
  using (
    auth.uid() = user_id
    or exists (
      select 1 from profiles
      where profiles.id = auth.uid() and profiles.is_moderator = true
    )
  );
