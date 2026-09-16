-- Index de performance (audit sécurité/perf, P-2). Aucune contrainte
-- unique/PK ne couvrait ces colonnes malgré des filtres .eq() fréquents
-- dans le code (lib/study/queries.ts, lesson-queries.ts, flashcard-queries.ts,
-- exercise-history-queries.ts, streak.ts) — chaque requête forçait un scan
-- séquentiel complet de la table. Sans données de volume réel en
-- production pour l'instant, l'impact est surtout préventif : ces tables
-- grossissent avec chaque cours/chapitre/révision et le scan séquentiel
-- se dégraderait linéairement avec l'usage.

-- study_chapters.study_course_id : liste des chapitres d'un cours
-- (queries.ts), rejoint aussi par study_chapters_with_progress (vue,
-- migration 0006) à chaque affichage de la page cours.
create index if not exists idx_study_chapters_study_course_id
  on public.study_chapters (study_course_id);

-- study_flashcards.study_chapter_id : chargement des cartes d'un chapitre
-- (flashcard-queries.ts).
create index if not exists idx_study_flashcards_study_chapter_id
  on public.study_flashcards (study_chapter_id);

-- study_flashcards_progress : clé primaire (flashcard_id, user_id) — déjà
-- indexée pour flashcard_id seul (préfixe de la PK composite), mais pas
-- pour user_id seul (streak.ts filtre uniquement sur user_id, sans
-- connaître flashcard_id).
create index if not exists idx_study_flashcards_progress_user_id
  on public.study_flashcards_progress (user_id);

-- study_exercise_history : lu par study_chapter_id (next-up.ts, via
-- exercise-history-queries.ts) ET par user_id (streak.ts) selon l'écran —
-- deux index simples plutôt qu'un composite, aucune requête actuelle ne
-- filtre sur les deux colonnes à la fois.
create index if not exists idx_study_exercise_history_study_chapter_id
  on public.study_exercise_history (study_chapter_id);
create index if not exists idx_study_exercise_history_user_id
  on public.study_exercise_history (user_id);

-- study_lessons_cache et study_web_enrichment n'ont pas besoin d'index
-- supplémentaire : study_chapter_id y est déjà la clé primaire.

-- study_course_files.study_course_id : liste des fichiers sources d'un
-- cours (queries.ts, deleteCourse).
create index if not exists idx_study_course_files_study_course_id
  on public.study_course_files (study_course_id);

-- study_courses.user_id : liste des cours de l'utilisateur (queries.ts) —
-- la table de plus haut niveau, lue à chaque affichage du tableau de bord.
create index if not exists idx_study_courses_user_id
  on public.study_courses (user_id);
