-- Complète 0003_study_mode.sql avec tout ce qui a été exécuté directement
-- en production via le SQL Editor (docs/db-anpassung.md §3/§3bis/§3ter/
-- §6bis/§6quater) sans jamais être reporté dans un fichier de migration —
-- voir docs/db-anpassung.md §7 ("Reste à faire") et l'audit sécurité qui a
-- confirmé cet écart (A-3 : "les migrations ne sont plus la source de
-- vérité"). Sans ce fichier, `supabase db push` sur une base neuve produit
-- un schéma sur lequel l'application ne démarre pas (get-chapter-for-
-- prompt.ts sélectionne `profile`, colonne absente de 0003 seul → 404 sur
-- toutes les routes de génération).
--
-- Entièrement additif et idempotent (add column if not exists, create
-- table if not exists, drop policy if exists) — rejouable sans risque sur
-- une base qui a déjà reçu ce SQL via le SQL Editor.

-- ── study_course_files : colonnes manquantes de 0003 ────────────────────

alter table public.study_course_files
  add column if not exists file_name text generated always as (filename) stored;

alter table public.study_course_files
  add column if not exists next_slice_index integer not null default 0;

-- ── study_chapters : colonnes manquantes de 0003 ────────────────────────

alter table public.study_chapters add column if not exists title text;
alter table public.study_chapters add column if not exists code_snippets jsonb not null default '[]'::jsonb;
alter table public.study_chapters add column if not exists code_lang text;
alter table public.study_chapters add column if not exists profile text;

-- Chapitre organisationnel (plan de semestre, modalités d'examen...) —
-- voir docs/db-anpassung.md §6bis : reste numéroté et visible, mais exclu
-- de mastery_pct/next_review, sans cours détaillé ni exercices.
alter table public.study_chapters add column if not exists is_organizational boolean not null default false;

-- title (depuis title_de) et profile (depuis study_courses.profile) sont
-- dérivés automatiquement à l'insertion/mise à jour — sans ce trigger,
-- title resterait NULL et profile ne serait jamais synchronisé.
create or replace function public.study_chapters_fill_derived()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.title is null then
    new.title := new.title_de;
  end if;

  select c.profile into new.profile
  from public.study_courses c
  where c.id = new.study_course_id;

  return new;
end;
$$;

drop trigger if exists study_chapters_fill_derived_trg on public.study_chapters;
create trigger study_chapters_fill_derived_trg
  before insert or update on public.study_chapters
  for each row execute function public.study_chapters_fill_derived();

-- ── study_courses.exam_date — voir docs/db-anpassung.md §3ter ───────────
-- Date d'examen saisie manuellement (export .ics du planning de
-- révision) — null tant que non planifiée.

alter table public.study_courses add column if not exists exam_date date;

-- ── study_web_enrichment — voir docs/db-anpassung.md §3bis ──────────────
-- "Pour aller plus loin" : 2-3 sources web_search par chapitre, en cache
-- PARTAGÉ entre tous les utilisateurs (clé primaire = study_chapter_id
-- seul, pas de user_id) — un chapitre déjà enrichi par quelqu'un ne coûte
-- plus rien aux suivants.

create table if not exists public.study_web_enrichment (
  study_chapter_id  uuid primary key references public.study_chapters(id) on delete cascade,
  content           jsonb not null,
  model             text not null,
  generated_at      timestamptz not null default now()
);

alter table public.study_web_enrichment enable row level security;

drop policy if exists "study_web_enrichment_via_chapter" on public.study_web_enrichment;
create policy "study_web_enrichment_via_chapter"
  on public.study_web_enrichment for all
  using (
    exists (
      select 1 from public.study_chapters c
      where c.id = study_web_enrichment.study_chapter_id
        and c.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.study_chapters c
      where c.id = study_web_enrichment.study_chapter_id
        and c.user_id = auth.uid()
    )
  );

-- ── study_exercise_history — voir docs/db-anpassung.md §3 ───────────────
-- Une ligne par réponse (Speed Round et autres) — alimente
-- lib/study/next-up.ts (pickNextExercise) et le signal "maîtrise par
-- exercices" de la vue de progression (0006). Append-only côté
-- application, pas de contrainte d'unicité : plusieurs tentatives sur le
-- même (chapitre, type) sont attendues.

create table if not exists public.study_exercise_history (
  id                uuid primary key default gen_random_uuid(),
  study_chapter_id  uuid not null references public.study_chapters(id) on delete cascade,
  user_id           uuid not null references auth.users(id) on delete cascade,
  exercise_type     text not null,
  correct           boolean not null,
  answered_at       timestamptz not null default now()
);

alter table public.study_exercise_history enable row level security;

drop policy if exists "study_exercise_history_user_own" on public.study_exercise_history;
create policy "study_exercise_history_user_own"
  on public.study_exercise_history for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── study_ai_usage + increment_ai_usage() — voir docs/db-anpassung.md §3 ─
-- Rate-limiting par utilisateur/catégorie/heure (lib/study/rate-limit.ts).
-- Une ligne par (user_id, category, hour_bucket), incrémentée
-- atomiquement — pas un log détaillé par appel, juste un compteur.

create table if not exists public.study_ai_usage (
  user_id      uuid not null references auth.users(id) on delete cascade,
  category     text not null,
  hour_bucket  timestamptz not null,
  count        integer not null default 0,

  primary key (user_id, category, hour_bucket)
);

alter table public.study_ai_usage enable row level security;

drop policy if exists "study_ai_usage_user_own" on public.study_ai_usage;
create policy "study_ai_usage_user_own"
  on public.study_ai_usage for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- security definer : nécessaire pour que l'incrémentation soit atomique
-- (insert ... on conflict ... do update) sous RLS. Le check auth.uid() =
-- v_user_id à l'intérieur remplace la policy RLS habituelle (contournée
-- par security definer) — un appelant ne peut incrémenter que son propre
-- compteur. search_path figé (corrige "Function Search Path Mutable" du
-- Security Advisor, voir docs/db-anpassung.md §4bis).
create or replace function public.increment_ai_usage(p_category text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_bucket timestamptz := date_trunc('hour', now());
  v_count integer;
begin
  if v_user_id is null then
    raise exception 'Non authentifié';
  end if;

  insert into public.study_ai_usage (user_id, category, hour_bucket, count)
  values (v_user_id, p_category, v_bucket, 1)
  on conflict (user_id, category, hour_bucket)
    do update set count = study_ai_usage.count + 1
  returning count into v_count;

  return v_count;
end;
$$;

-- ── study_approved_users — voir docs/db-anpassung.md §6quater ───────────
-- Approbation manuelle des nouveaux comptes : l'inscription publique reste
-- ouverte, mais créer un cours/uploader un fichier (le seul point d'entrée
-- qui déclenche des appels IA payants) exige une ligne ici. Écrite
-- uniquement via le SQL Editor (aucune policy insert/update/delete côté
-- client) — voir §6quater pour la requête d'approbation.

create table if not exists public.study_approved_users (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  approved_at  timestamptz not null default now()
);

alter table public.study_approved_users enable row level security;

drop policy if exists "study_approved_users_read_own" on public.study_approved_users;
create policy "study_approved_users_read_own"
  on public.study_approved_users for select
  using (auth.uid() = user_id);

-- Policies INSERT séparées, EN PLUS des policies "for all" existantes de
-- 0003 (study_courses_user_own / study_course_files_user_own, inchangées :
-- select/update/delete sur ses propres lignes continuent de fonctionner
-- sans restriction supplémentaire).
drop policy if exists "study_courses_insert_requires_approval" on public.study_courses;
create policy "study_courses_insert_requires_approval"
  on public.study_courses for insert
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.study_approved_users a where a.user_id = auth.uid())
  );

drop policy if exists "study_course_files_insert_requires_approval" on public.study_course_files;
create policy "study_course_files_insert_requires_approval"
  on public.study_course_files for insert
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.study_approved_users a where a.user_id = auth.uid())
  );
