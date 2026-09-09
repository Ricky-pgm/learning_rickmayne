import type { Lang } from "@/lib/chapters/types"

export type CourseProfile = "programming" | "theory" | "mixed"

export interface StudyCourse {
  id: string
  user_id: string
  title: string
  profile: CourseProfile
  detected_lang: Lang | null
  created_at: string
  /** Date d'examen (YYYY-MM-DD), saisie manuellement — voir docs/db-anpassung.md §3ter.
   * null tant que l'examen n'est pas encore planifié. */
  exam_date: string | null
}

export type StudyCourseFileStatus = "pending" | "processing" | "done" | "error"

export interface StudyCourseFile {
  id: string
  study_course_id: string
  user_id: string
  storage_path: string
  filename: string
  /** Colonne générée côté DB (voir docs/db-anpassung.md §3) — alias de filename. */
  file_name: string
  status: StudyCourseFileStatus
  error_message: string | null
  uploaded_at: string
  processed_at: string | null
  /** Prochaine tranche à traiter (0-based) — voir docs/db-anpassung.md §3. */
  next_slice_index: number
}

export interface StudyChapter {
  id: string
  study_course_id: string
  user_id: string
  order: number

  // Titres bilingues (ingestion IA + cours détaillé) et titre simple pour
  // l'affichage. `title` est rempli automatiquement depuis `title_de` par
  // un trigger DB si non fourni — voir docs/db-anpassung.md §3.
  title_de: string
  title_fr: string
  title: string

  concepts: string[]
  summary: string

  has_code: boolean
  code_snippets: string[]
  code_lang: Lang | null

  /** Dupliqué depuis study_courses.profile par trigger DB — jamais à écrire à la main. */
  profile: CourseProfile

  /** Contenu organisationnel (plan de semestre, modalités d'examen,
   * contacts...) plutôt que du contenu de cours — voir
   * docs/db-anpassung.md §6bis. N'a ni flashcards ni exercices ni cours
   * détaillé, juste son résumé ; exclu des stats de progression. */
  is_organizational: boolean

  source_file_id: string | null
  created_at: string
}

export interface Flashcard {
  id: string
  study_chapter_id: string
  user_id: string
  front_de: string
  back_de: string
  back_fr: string
}

export type FlashcardGrade = "again" | "hard" | "good" | "easy"

export interface FlashcardProgress {
  flashcard_id: string
  user_id: string
  interval_days: number
  ease_factor: number
  due_at: string
  last_grade: FlashcardGrade | null
  reviews: number
}

export type StudyExerciseType =
  | "mcq"
  | "matching"
  | "trueFalse"
  | "fillBlank"
  | "codeAnalysis"
  | "code"
  | "speedRound"
  | "bugHunt"
  | "conceptMap"

/** One completed exercise attempt, used by the next-up selection algorithm. */
export interface ExerciseHistoryEntry {
  study_chapter_id: string
  exercise_type: string
  correct: boolean
  answered_at: string
}

export interface ExerciseTypeWeight {
  exerciseType: string
  weight: number
}
