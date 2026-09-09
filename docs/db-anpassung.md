# DB Anpassung — mode Étude

À exécuter dans Supabase (SQL Editor), dans l'ordre. Rien n'a encore été
appliqué. Vérifié champ par champ contre les 3 pages `/etude`.

## 0. Où / comment

1. [supabase.com/dashboard](https://supabase.com/dashboard) → projet `it-learn` → **SQL Editor** → **New query** → coller le bloc → **Run**.
2. Un bloc à la fois, dans l'ordre des sections (clés étrangères entre tables).
3. Tous les blocs sont idempotents (`if not exists` / `drop policy if exists`) — rejouables sans risque.

Déjà appliqué ?

```sql
select table_name from information_schema.tables
where table_schema = 'public' and table_name like 'study_%'
order by table_name;
```

## 1. Sécurité — état des lieux

| Point | État |
|---|---|
| Mots de passe | Gérés par Supabase Auth, hash bcrypt côté serveur. Aucune table `users`/`password` custom. Rien à faire. |
| RLS | Activé sur toutes les tables `study_*`, policy `auth.uid() = user_id`. |
| `with check` | Présent sur toutes les policies, y compris `study_lessons_cache` (manquant dans une version antérieure, corrigé). |
| Clé `anon`/`public` | OK à exposer côté client (`NEXT_PUBLIC_SUPABASE_ANON_KEY`), protégée par RLS. |
| Clé `service_role` | Jamais utilisée dans ce projet — contourne RLS entièrement. |
| `ANTHROPIC_API_KEY` | Serveur seulement, jamais `NEXT_PUBLIC_*`. |

`.env.local` doit rester dans `.gitignore` (déjà couvert par `.env*`).

## 2. Ordre d'exécution

| # | Contenu | Statut |
|---|---|---|
| 1 | `0001_progress.sql` | Probablement déjà en prod |
| 2 | `0002_multi_course.sql` | Probablement déjà en prod |
| 3 | §3 ci-dessous — tables `study_*` | À jouer |
| 4 | §4 ci-dessous — vue de progression | À jouer |
| 5 | §5 ci-dessous — bucket Storage | À jouer |

Vérifier 1/2 : `select column_name from information_schema.columns where table_schema='public' and table_name='progress';` — si `course_id` apparaît, passer direct à §3.

## 3. Tables `study_*`

| Table | Rôle | RLS |
|---|---|---|
| `study_courses` | Cours créé par l'utilisateur | `user_id` direct |
| `study_course_files` | PDF uploadés | `user_id` direct |
| `study_chapters` | Chapitres extraits par l'IA | `user_id` direct |
| `study_lessons_cache` | Cours détaillé généré, en cache | via jointure `study_chapters` |
| `study_web_enrichment` | Sources externes (web_search) par chapitre, en cache — voir §3bis | via jointure `study_chapters` |
| `study_flashcards` | Cartes de révision par chapitre | `user_id` direct |
| `study_flashcards_progress` | Progression SM-2 par carte | `user_id` direct |
| `study_exercise_history` | Historique des réponses au Speed Round, alimente pickNextExercise | `user_id` direct |
| `study_ai_usage` | Compteur d'appels IA par utilisateur/heure, pour le rate-limiting | `user_id` direct |

Colonnes ajoutées vs. version initiale, et pourquoi :

| Colonne | Table | Raison |
|---|---|---|
| `title` | `study_chapters` | Titre simple affiché par les pages ; rempli depuis `title_de` par trigger si absent |
| `code_snippets`, `code_lang` | `study_chapters` | Lus directement par la page chapitre (`hasCode`, coloration syntaxique) |
| `profile` | `study_chapters` | Dosage d'exercices sans jointure ; synchronisé depuis `study_courses.profile` par trigger |
| `file_name` | `study_course_files` | Alias généré de `filename` (colonne réelle inchangée) pour matcher le dashboard |

`mastery_pct`/`next_review` ne sont **pas** des colonnes ici — voir §4.

```sql
-- Mode Étude : nouvelles tables study_*
-- Ajout purement additif, aucune modification de progress ni de ses policies.

create table if not exists public.study_courses (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  title         text not null,
  profile       text not null check (profile in ('programming', 'theory', 'mixed')),
  detected_lang text,
  created_at    timestamptz not null default now()
);

alter table public.study_courses enable row level security;

drop policy if exists "study_courses_user_own" on public.study_courses;
create policy "study_courses_user_own"
  on public.study_courses for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table if not exists public.study_course_files (
  id               uuid primary key default gen_random_uuid(),
  study_course_id  uuid not null references public.study_courses(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  storage_path     text not null,
  filename         text not null,
  file_name        text generated always as (filename) stored,
  status           text not null default 'pending'
                     check (status in ('pending', 'processing', 'done', 'error')),
  error_message    text,
  uploaded_at      timestamptz not null default now(),
  processed_at     timestamptz,
  -- Index de la prochaine tranche à traiter, 0-based — sur un cours
  -- volumineux découpé en plusieurs tranches (voir lib/study/pdf-split.ts),
  -- "Réessayer" repartait sans ça depuis la tranche 0 à chaque tentative,
  -- retraitant (et repayant) les tranches déjà réussies. Avancé après
  -- chaque tranche réussie (advanceNextSliceIndex) ; démarre à 0 pour tout
  -- nouveau fichier (uploadFile insère toujours une nouvelle ligne).
  next_slice_index integer not null default 0
);

alter table public.study_course_files enable row level security;

-- Idempotent : ajoute la colonne si la table existait déjà avant ce champ.
alter table public.study_course_files
  add column if not exists next_slice_index integer not null default 0;

drop policy if exists "study_course_files_user_own" on public.study_course_files;
create policy "study_course_files_user_own"
  on public.study_course_files for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table if not exists public.study_chapters (
  id               uuid primary key default gen_random_uuid(),
  study_course_id  uuid not null references public.study_courses(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  "order"          integer not null,

  title_de         text not null,
  title_fr         text not null,
  title            text,

  concepts         jsonb not null default '[]'::jsonb,
  summary          text not null,

  has_code         boolean not null default false,
  code_snippets    jsonb not null default '[]'::jsonb,
  code_lang        text,

  profile          text,

  source_file_id   uuid references public.study_course_files(id) on delete set null,
  created_at       timestamptz not null default now(),

  unique (study_course_id, "order")
);

alter table public.study_chapters enable row level security;

drop policy if exists "study_chapters_user_own" on public.study_chapters;
create policy "study_chapters_user_own"
  on public.study_chapters for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.study_chapters_fill_derived()
returns trigger
language plpgsql
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

create table if not exists public.study_lessons_cache (
  study_chapter_id  uuid primary key references public.study_chapters(id) on delete cascade,
  content           jsonb not null,
  model             text not null,
  generated_at      timestamptz not null default now()
);

alter table public.study_lessons_cache enable row level security;

drop policy if exists "study_lessons_cache_via_chapter" on public.study_lessons_cache;
create policy "study_lessons_cache_via_chapter"
  on public.study_lessons_cache for all
  using (
    exists (
      select 1 from public.study_chapters c
      where c.id = study_lessons_cache.study_chapter_id
        and c.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.study_chapters c
      where c.id = study_lessons_cache.study_chapter_id
        and c.user_id = auth.uid()
    )
  );

create table if not exists public.study_flashcards (
  id               uuid primary key default gen_random_uuid(),
  study_chapter_id uuid not null references public.study_chapters(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  front_de         text not null,
  back_de          text not null,
  back_fr          text not null,
  created_at       timestamptz not null default now()
);

alter table public.study_flashcards enable row level security;

drop policy if exists "study_flashcards_user_own" on public.study_flashcards;
create policy "study_flashcards_user_own"
  on public.study_flashcards for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table if not exists public.study_flashcards_progress (
  flashcard_id    uuid not null references public.study_flashcards(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  interval_days   integer not null default 1,
  ease_factor     real not null default 2.5,
  due_at          timestamptz not null default now(),
  last_grade      text check (last_grade in ('again', 'hard', 'good', 'easy')),
  reviews         integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  primary key (flashcard_id, user_id)
);

alter table public.study_flashcards_progress enable row level security;

drop policy if exists "study_flashcards_progress_user_own" on public.study_flashcards_progress;
create policy "study_flashcards_progress_user_own"
  on public.study_flashcards_progress for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Un enregistrement par réponse au Speed Round — alimente
-- lib/study/next-up.ts (pickNextExercise), qui pondère le prochain
-- exercice suggéré par chapitre selon le taux de réussite réel observé.
-- Append-only côté application (jamais de update), pas de contrainte
-- d'unicité : plusieurs tentatives sur le même (chapitre, type) sont
-- attendues et voulues.
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

-- Rate-limiting par utilisateur/catégorie/heure — un compte authentifié
-- (le tien ou un compte compromis) ne peut plus déclencher un nombre
-- illimité d'appels Anthropic payants. Une ligne par (user_id, category,
-- hour_bucket), incrémentée atomiquement par la fonction ci-dessous — pas
-- un log détaillé par appel, juste un compteur, la table reste petite
-- (les vieux buckets ne sont jamais lus après leur heure, purge périodique
-- optionnelle plus tard si le volume le justifie).
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
-- (insert ... on conflict ... do update) sous RLS, appelée par
-- lib/study/rate-limit.ts via supabase.rpc(). Le check auth.uid() = p_user_id
-- à l'intérieur remplace la policy RLS habituelle (contournée par security
-- definer) — un appelant ne peut incrémenter que son propre compteur.
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
```

## 3ter. `study_courses.exam_date` — planification des révisions

Ajouté pour le calendrier de révisions (export `.ics`, voir
`docs/etude-ai-architecture.md`) : date d'examen saisie manuellement par
l'utilisateur sur chaque cours (pas d'extraction automatique depuis un
PDF de planning — trop fragile à parser de façon fiable, préféré une
saisie simple et exacte). `null` tant que l'examen n'est pas encore
planifié — un cours sans date n'entre simplement pas dans le calcul de
répartition des révisions.

```sql
alter table public.study_courses
  add column if not exists exam_date date;
```

## 3bis. `study_web_enrichment` — sources externes en cache

Ajouté après §3 (voir `docs/etude-ai-architecture.md` pour le contexte
complet) — "Pour aller plus loin" sur la page chapitre : 2-3 sources
fiables trouvées via l'outil `web_search` de l'API Anthropic, en
complément du contenu déjà extrait du PDF. Même principe que
`study_lessons_cache` : générée une fois par chapitre, à la demande
(bouton explicite, pas automatique), **jamais régénérée
automatiquement**, cache partagé entre tous les utilisateurs (clé
primaire = `study_chapter_id` seul, pas de `user_id`) — un chapitre déjà
enrichi par un utilisateur ne coûte plus rien aux suivants.

```sql
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
```

## 4. Vue de progression (`mastery_pct`, `next_review`)

Calculées à la volée depuis `study_flashcards_progress`, pas stockées —
sinon désynchronisation garantie après chaque révision.

**Révision (§6ter)** : `mastery_pct` ne comptait au départ QUE les
flashcards — un chapitre entièrement pratiqué via Speed Round/Carte de
concepts/Memory/Bug Hunt/Texte à trous, sans jamais ouvrir la Lernkartei,
restait pour toujours à 0% de maîtrise. La vue combine maintenant les deux
signaux (flashcards ET exercices) en prenant le plus favorable des deux —
un vrai travail effectué dans n'importe quel mode compte, sans forcer
personne à passer par les flashcards spécifiquement.

```sql
create or replace view public.study_chapters_with_progress as
select
  c.*,
  greatest(
    coalesce(
      round(
        100.0 * count(distinct f.id) filter (
          where p.reviews > 0 and p.ease_factor >= 2.5 and p.last_grade in ('good', 'easy')
        ) / nullif(count(distinct f.id), 0)
      ),
      0
    ),
    coalesce(ex.exercise_mastery_pct, 0)
  )::int as mastery_pct,
  min(p.due_at) filter (where p.reviews > 0) as next_review
from public.study_chapters c
left join public.study_flashcards f on f.study_chapter_id = c.id
left join public.study_flashcards_progress p
  on p.flashcard_id = f.id and p.user_id = c.user_id
left join lateral (
  -- Signal de maîtrise par exercices — seulement si au moins 3 réponses
  -- ont été enregistrées pour ce chapitre (une seule bonne réponse
  -- chanceuse ne doit pas afficher 100%), sur les 10 réponses les plus
  -- récentes seulement (le niveau reflète la pratique récente, pas la
  -- toute première tentative d'il y a des semaines).
  select
    case when count(*) >= 3
      then round(100.0 * count(*) filter (where h.correct) / count(*))
      else null
    end as exercise_mastery_pct
  from (
    select correct
    from public.study_exercise_history
    where study_chapter_id = c.id and user_id = c.user_id
    order by answered_at desc
    limit 10
  ) h
) ex on true
group by c.id, ex.exercise_mastery_pct;
```

| Champ | Calcul | `null`/`0` quand |
|---|---|---|
| `mastery_pct` | Le plus favorable entre : % de cartes "good"/"easy" (flashcards), et % de bonnes réponses sur les 10 dernières réponses d'exercice (si ≥ 3 réponses) | `0` si aucune carte révisée ET moins de 3 réponses d'exercice |
| `next_review` | Échéance la plus proche parmi les cartes déjà révisées | `null` si aucune carte encore révisée |

RLS hérité automatiquement de `study_chapters` — pas de policy à ajouter sur la vue.

**Fait** : `lib/study/lesson-queries.ts::listAllStudyChaptersForUser` lit bien `study_chapters_with_progress`.

## 4bis. Corrections Security Advisor

Deux points remontés par l'onglet **Advisors → Security Advisor** de Supabase après application des sections 3 et 4, à corriger avant de considérer la migration terminée.

| Type | Entité | Problème | Correctif |
|---|---|---|---|
| Error | `study_chapters_fill_derived` (trigger) | `search_path` non figé — la fonction peut résoudre `public.study_courses` vers un mauvais schéma si le `search_path` de la session est manipulé | `set search_path = public` sur la fonction |
| Warning | `study_chapters_with_progress` (vue) | Vue en mode `SECURITY DEFINER` implicite — s'exécute avec les droits du créateur, pas du visiteur | Forcer `security_invoker = true` pour que la vue applique le RLS du visiteur |

```sql
-- Fige le search_path du trigger (corrige "Function Search Path Mutable")
alter function public.study_chapters_fill_derived() set search_path = public;

-- Force la vue à s'exécuter avec les droits du visiteur, pas du créateur
-- (corrige "Security Definer View") — sans risque ici puisque les tables
-- sous-jacentes sont déjà filtrées par RLS sur user_id, mais on l'explicite.
alter view public.study_chapters_with_progress set (security_invoker = true);
```

Vérification :

```sql
-- doit retourner 'public' pour proconfig contenant search_path=public
select proconfig from pg_proc where proname = 'study_chapters_fill_derived';

-- doit retourner true
select reloptions from pg_class where relname = 'study_chapters_with_progress';
```

Le 3ème point du Security Advisor (**Leaked Password Protection Disabled**) ne concerne pas ce schéma — c'est un réglage global d'Auth. Optionnel : **Authentication → Providers → Email** → activer "Leaked password protection" (vérifie les mots de passe contre des fuites connues via HaveIBeenPwned au moment de l'inscription).

## 5. Bucket Storage

Chemin attendu : `{user_id}/{study_course_id}/{filename}` — upload direct client → Storage (pas de route API, limite de payload trop basse pour des PDF complets).

```sql
insert into storage.buckets (id, name, public)
values ('study-course-files', 'study-course-files', false)
on conflict (id) do nothing;

drop policy if exists "Users manage their own study course files" on storage.objects;
create policy "Users manage their own study course files"
  on storage.objects
  for all
  using (
    bucket_id = 'study-course-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'study-course-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
```

Bucket privé (`public = false`) — vérifier après coup : onglet **Storage**, cadenas visible.

## 6. Vérification finale

```sql
-- 1. Tables + RLS + policies
select
  t.table_name,
  (select count(*) from pg_policies p where p.tablename = t.table_name) as nb_policies,
  c.relrowsecurity as rls_active
from information_schema.tables t
join pg_class c on c.relname = t.table_name
where t.table_schema = 'public'
  and t.table_name like 'study_%'
order by t.table_name;

-- 2. Vue OK
select * from public.study_chapters_with_progress limit 1;

-- 3. Bucket privé
select id, public from storage.buckets where id = 'study-course-files';
```

| Attendu | Requête |
|---|---|
| 6 lignes, `rls_active = true`, `nb_policies >= 1` partout | #1 |
| Pas d'erreur (0 ligne OK) | #2 |
| 1 ligne, `public = false` | #3 |

Si `rls_active = false` ou `nb_policies = 0` quelque part : ne pas lancer l'app dessus — ça exposerait les données de tous les utilisateurs entre eux.

## 6bis. Chapitres organisationnels (plan de semestre, modalités d'examen...)

Un PDF de cours contient souvent des pages qui ne sont pas du contenu à réviser : plan du semestre, règles de présence, modalités d'examen, contacts. Avant cette colonne, l'ingestion en faisait un chapitre comme un autre — avec concepts, flashcards, exercices — ce qui n'a pas de sens pédagogique.

```sql
alter table public.study_chapters add column if not exists is_organizational boolean not null default false;
```

Un chapitre marqué `is_organizational = true` :
- reste numéroté et visible dans la liste des chapitres du cours (l'info existe, l'étudiant doit pouvoir la retrouver),
- n'affiche que son résumé (pas de cours détaillé, pas de flashcards, pas d'exercices, pas d'estimation de temps, pas de bouton "Pour aller plus loin"),
- est exclu de `mastery_pct`/`next_review` côté UI (n'entre jamais dans les stats de progression ni dans le streak),
- n'a pas de code_lang/has_code pertinents (toujours `false`/`null` pour ce type de chapitre).

`study_chapters.*` dans `study_chapters_with_progress` (§4) inclut automatiquement cette colonne — pas de migration de vue nécessaire.

## 6ter. Fix `reviews` jamais écrit + maîtrise par exercices

**À exécuter** — deux problèmes trouvés en usage réel (chapitre pratiqué via Carte de concepts, maîtrise restée à 0% après un chapitre visiblement fini) :

1. `saveFlashcardProgress` (lib/study/flashcard-queries.ts) faisait un `upsert` sans jamais inclure `reviews` — la colonne restait à son `default 0` pour toujours, quel que soit le nombre réel de révisions. Bug corrigé côté code (`reviews: state.reviews` ajouté à l'upsert), rien à migrer en base pour ce point : les lignes déjà écrites avec `reviews = 0` se corrigeront de fait à la prochaine notation de chacune de ces cartes.
2. `mastery_pct` ne comptait que les flashcards — jamais les exercices (Speed Round, Carte, Memory, Bug Hunt, Texte à trous). Un chapitre pratiqué uniquement via ces modes restait à 0% même sans le bug ci-dessus. La vue `study_chapters_with_progress` du §4 a été réécrite pour combiner les deux signaux (le plus favorable des deux) — **remplacer la vue existante par la nouvelle définition du §4** :

```sql
-- Recolle exactement la définition du §4 ci-dessus (create or replace,
-- donc sans risque de doublon) :
create or replace view public.study_chapters_with_progress as
select
  c.*,
  greatest(
    coalesce(
      round(
        100.0 * count(distinct f.id) filter (
          where p.reviews > 0 and p.ease_factor >= 2.5 and p.last_grade in ('good', 'easy')
        ) / nullif(count(distinct f.id), 0)
      ),
      0
    ),
    coalesce(ex.exercise_mastery_pct, 0)
  )::int as mastery_pct,
  min(p.due_at) filter (where p.reviews > 0) as next_review
from public.study_chapters c
left join public.study_flashcards f on f.study_chapter_id = c.id
left join public.study_flashcards_progress p
  on p.flashcard_id = f.id and p.user_id = c.user_id
left join lateral (
  select
    case when count(*) >= 3
      then round(100.0 * count(*) filter (where h.correct) / count(*))
      else null
    end as exercise_mastery_pct
  from (
    select correct
    from public.study_exercise_history
    where study_chapter_id = c.id and user_id = c.user_id
    order by answered_at desc
    limit 10
  ) h
) ex on true
group by c.id, ex.exercise_mastery_pct;

-- Ré-applique le security_invoker (§4bis) — create or replace le remet
-- au comportement par défaut, à refaire chaque fois que la vue change :
alter view public.study_chapters_with_progress set (security_invoker = true);
```

Vérification : jouer un exercice sur un chapitre jusqu'à 3 bonnes réponses (n'importe quel type), revenir sur la page cours — `mastery_pct` doit refléter ce travail sans avoir touché aux flashcards.

## 7. Reste à faire (plus tard, pas maintenant)

Reporter le SQL des §3/§4 dans `supabase/migrations/0003_study_mode.sql` (+ un `0005_study_progress_view.sql` séparé pour la vue), pour que `supabase db push` redevienne la source de vérité.

## 8. Empêcher la pause Supabase (plan Free)

Décision : ping GitHub Actions plutôt que migrer vers Appwrite (aurait demandé de réécrire auth/données/storage pour tout le projet, y compris le mode Klausur existant). Fichier : `.github/workflows/supabase-keepalive.yml`, ping toutes les 3 jours (seuil de pause : ~7 jours).

À faire : Repo GitHub → **Settings → Secrets and variables → Actions** → créer :

| Secret | Valeur |
|---|---|
| `SUPABASE_URL` | = `NEXT_PUBLIC_SUPABASE_URL` de `.env.local` |
| `SUPABASE_ANON_KEY` | = `NEXT_PUBLIC_SUPABASE_ANON_KEY` de `.env.local` |

Clés publiques, protégées par RLS — même valeurs déjà exposées côté navigateur.

Test manuel : onglet **Actions** → `Supabase keepalive` → **Run workflow**.
