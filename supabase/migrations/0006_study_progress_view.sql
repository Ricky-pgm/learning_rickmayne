-- Vue de progression (mastery_pct, next_review) — voir
-- docs/db-anpassung.md §4. Calculée à la volée depuis
-- study_flashcards_progress ET study_exercise_history (le plus favorable
-- des deux signaux), jamais stockée — sinon désynchronisation garantie
-- après chaque révision. Dépend de 0005 (study_exercise_history,
-- is_organizational).
--
-- drop + create (pas "create or replace") : is_organizational a été
-- ajoutée à study_chapters après la création initiale de cette vue en
-- production, et Postgres refuse un "create or replace" qui changerait la
-- position/le nom d'une colonne de sortie existante (erreur 42P16) — sans
-- risque, une vue ne stocke aucune donnée, drop ne supprime rien.

drop view if exists public.study_chapters_with_progress;

create view public.study_chapters_with_progress as
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

-- Corrige "Security Definer View" du Security Advisor (docs/db-anpassung.md
-- §4bis) : sans ça, la vue s'exécute avec les droits du créateur plutôt
-- que du visiteur — sans risque ici puisque les tables sous-jacentes sont
-- déjà filtrées par RLS sur user_id, mais on l'explicite. Doit être
-- réappliqué après CHAQUE create/create or replace de la vue, cette
-- option n'étant pas conservée automatiquement.
alter view public.study_chapters_with_progress set (security_invoker = true);
