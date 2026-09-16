-- Bucket de stockage pour les fichiers de cours uploadés dans le mode
-- étude (/etude). Upload direct client → Storage (pas via une route API
-- Next, qui a une limite de payload trop basse pour des PDF de cours
-- complets — voir doc §5.3 étape 1). Chemin attendu :
-- {user_id}/{study_course_id}/{filename}, pour que les policies RLS
-- puissent s'appuyer sur le premier segment du chemin.

insert into storage.buckets (id, name, public)
values ('study-course-files', 'study-course-files', false)
on conflict (id) do nothing;

-- Limite de type/taille côté bucket — voir docs/db-anpassung.md §5bis.
-- validateCourseFile (lib/study/storage.ts) rejette déjà un fichier non-PDF
-- ou trop lourd, mais côté navigateur uniquement — un appel direct à
-- l'API Storage avec la clé anon (publique) le contourne entièrement. La
-- policy RLS ci-dessous ne contrôle que le préfixe du chemin, jamais le
-- type ni la taille : seule cette limite posée sur le bucket lui-même
-- n'est pas contournable par le client. Un simple insert...on conflict do
-- nothing (ci-dessus) ne réapplique jamais ces colonnes sur un bucket déjà
-- existant, d'où cet update séparé, idempotent par nature.
update storage.buckets
set allowed_mime_types = array['application/pdf'],
    file_size_limit = 41943040  -- 40 Mo, même limite que validateCourseFile
where id = 'study-course-files';

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
