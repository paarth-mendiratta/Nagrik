-- Migration: report_comments table (for databases created before comments existed).
-- Paste into the Supabase SQL editor and run once. Identical to the section
-- already present in supabase/schema.sql for fresh installs.

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

create policy "Public read non-hidden comments"
  on report_comments for select
  using (is_hidden = false);

create policy "Authenticated users can insert comments"
  on report_comments for insert
  with check (auth.uid() = user_id);

create policy "Owner or moderator can update comments"
  on report_comments for update
  using (
    auth.uid() = user_id
    or exists (
      select 1 from profiles
      where profiles.id = auth.uid() and profiles.is_moderator = true
    )
  );
