-- RPC atomique pour l'enregistrement d'une tranche d'ingestion — corrige
-- deux problèmes confirmés par l'audit sécurité (C-3, F-2) :
--
-- C-3 (race condition) : lib/study/queries.ts::saveIngestResult recevait
-- l'offset de numérotation calculé côté client (countStudyChapters,
-- SELECT count(*) séparé, sans transaction). Deux ingestions concurrentes
-- sur le même cours (deux onglets, ou deux fichiers en parallèle) lisent
-- le même count, tentent d'insérer les mêmes "order" (contrainte unique
-- study_chapters(study_course_id, "order")) → le lot entier échoue en
-- 23505, perdant une tranche Sonnet déjà payée pour rien.
--
-- F-2 (non-idempotence) : countStudyChapters → saveIngestResult →
-- advanceNextSliceIndex sont 3 appels séparés depuis
-- app/etude/[courseId]/page.tsx. Si le 3e échoue (réseau coupé — le cas
-- le plus probable en plein milieu d'une ingestion longue),
-- next_slice_index reste périmé et la tranche déjà insérée est rejouée
-- (et repayée) au "Réessayer" suivant, avec un nouvel offset différent —
-- chapitres dupliqués sous une numérotation différente, pas détecté par
-- la contrainte unique.
--
-- Fix : les 3 opérations (calcul d'offset, insertion des chapitres, mise
-- à jour du profil du cours, avancement de la tranche) dans UNE seule
-- transaction Postgres — même principe qu'increment_ai_usage (déjà
-- atomique). Le client n'écrit plus jamais directement study_chapters
-- pour l'ingestion (mais garde le droit de le faire pour d'autres usages,
-- via la policy "for all" existante — cette RPC est un chemin
-- supplémentaire, pas un remplacement de policy).

create or replace function public.save_ingest_result(
  p_study_course_id uuid,
  p_source_file_id   uuid,
  p_profile          text,
  p_detected_lang    text,
  p_chapters         jsonb,
  p_slice_index      integer
)
returns integer  -- nombre de chapitres insérés
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id     uuid := auth.uid();
  v_file_course uuid;
  v_offset      integer;
  v_inserted    integer;
begin
  if v_user_id is null then
    raise exception 'Non authentifié';
  end if;

  -- Même contrôle que l'ancien saveIngestResult côté client : sourceFileId
  -- et studyCourseId doivent se correspondre, et appartenir à l'appelant —
  -- security definer contourne RLS, donc ces vérifications explicites
  -- remplacent la policy habituelle plutôt que de s'y ajouter.
  select study_course_id into v_file_course
  from public.study_course_files
  where id = p_source_file_id and user_id = v_user_id;

  if v_file_course is null then
    raise exception 'Fichier source introuvable ou accès refusé';
  end if;
  if v_file_course <> p_study_course_id then
    raise exception 'Ce fichier n''appartient pas au cours indiqué';
  end if;

  if not exists (
    select 1 from public.study_courses
    where id = p_study_course_id and user_id = v_user_id
  ) then
    raise exception 'Cours introuvable ou accès refusé';
  end if;

  -- Verrou explicite sur la ligne du cours : sérialise les transactions
  -- concurrentes sur CE cours (une deuxième transaction qui tente le même
  -- appel attend ici que la première commit), sans bloquer l'ingestion
  -- d'un cours différent. C'est ce qui élimine la race C-3 — le calcul de
  -- l'offset et l'insertion qui suit ne peuvent plus être entrelacés par
  -- deux transactions.
  perform 1 from public.study_courses where id = p_study_course_id for update;

  update public.study_courses
  set profile = p_profile, detected_lang = p_detected_lang
  where id = p_study_course_id;

  select coalesce(max("order"), 0) into v_offset
  from public.study_chapters
  where study_course_id = p_study_course_id;

  insert into public.study_chapters (
    study_course_id, user_id, "order", title_de, title_fr,
    concepts, summary, has_code, code_lang, is_organizational, source_file_id
  )
  select
    p_study_course_id,
    v_user_id,
    (elem->>'order')::integer + v_offset,
    elem->>'title_de',
    elem->>'title_fr',
    coalesce(elem->'concepts', '[]'::jsonb),
    elem->>'summary',
    coalesce((elem->>'has_code')::boolean, false),
    elem->>'code_lang',
    coalesce((elem->>'is_organizational')::boolean, false),
    p_source_file_id
  from jsonb_array_elements(p_chapters) as elem;

  get diagnostics v_inserted = row_count;

  update public.study_course_files
  set next_slice_index = p_slice_index + 1
  where id = p_source_file_id;

  return v_inserted;
end;
$$;
