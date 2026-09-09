import { getSupabaseClient } from "@/lib/supabase"
import { uploadCourseFile, deleteCourseFile } from "./storage"
import type { CourseProfile, StudyCourse, StudyCourseFile, StudyCourseFileStatus } from "./types"
import type { IngestResult } from "./ingest-prompt"

export async function createStudyCourse(userId: string, title: string): Promise<StudyCourse> {
  const { data, error } = await getSupabaseClient()
    .from("study_courses")
    .insert({ user_id: userId, title, profile: "mixed" })
    .select()
    .single()

  if (error || !data) {
    throw new Error(`Impossible de créer le cours: ${error?.message ?? "erreur inconnue"}`)
  }

  return data as StudyCourse
}

/** Alias de createStudyCourse — utilisé par app/etude/dashboard/page.tsx, accepte le profil dès la création. */
export async function createCourse(userId: string, title: string, profile: CourseProfile): Promise<StudyCourse> {
  const { data, error } = await getSupabaseClient()
    .from("study_courses")
    .insert({ user_id: userId, title, profile })
    .select()
    .single()

  if (error || !data) {
    throw new Error(`Impossible de créer le cours: ${error?.message ?? "erreur inconnue"}`)
  }

  return data as StudyCourse
}

export async function getStudyCourse(studyCourseId: string): Promise<StudyCourse | null> {
  const { data, error } = await getSupabaseClient()
    .from("study_courses")
    .select("*")
    .eq("id", studyCourseId)
    .maybeSingle()

  if (error) {
    throw new Error(`Impossible de charger le cours: ${error.message}`)
  }

  return (data as StudyCourse) ?? null
}

export async function listStudyCourses(userId: string): Promise<StudyCourse[]> {
  const { data, error } = await getSupabaseClient()
    .from("study_courses")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })

  if (error) {
    throw new Error(`Impossible de charger les cours: ${error.message}`)
  }

  return (data ?? []) as StudyCourse[]
}

/** Alias de listStudyCourses — utilisé par app/etude/dashboard/page.tsx. */
export const listCourses = listStudyCourses

export async function deleteCourse(studyCourseId: string): Promise<void> {
  const { error } = await getSupabaseClient()
    .from("study_courses")
    .delete()
    .eq("id", studyCourseId)

  if (error) {
    throw new Error(`Impossible de supprimer le cours: ${error.message}`)
  }
}

/**
 * Saisie manuelle de la date d'examen — voir docs/db-anpassung.md §3ter.
 * examDate=null efface la date (examen pas encore planifié / annulé).
 */
export async function setCourseExamDate(studyCourseId: string, examDate: string | null): Promise<void> {
  const { error } = await getSupabaseClient()
    .from("study_courses")
    .update({ exam_date: examDate })
    .eq("id", studyCourseId)

  if (error) {
    throw new Error(`Impossible d'enregistrer la date d'examen: ${error.message}`)
  }
}

export async function createStudyCourseFile(
  studyCourseId: string,
  filename: string,
  storagePath: string,
  userId: string
): Promise<StudyCourseFile> {
  const { data, error } = await getSupabaseClient()
    .from("study_course_files")
    .insert({ study_course_id: studyCourseId, filename, storage_path: storagePath, status: "pending", user_id: userId })
    .select()
    .single()

  if (error || !data) {
    throw new Error(`Impossible d'enregistrer le fichier: ${error?.message ?? "erreur inconnue"}`)
  }

  return data as StudyCourseFile
}

export async function updateStudyCourseFileStatus(
  fileId: string,
  status: StudyCourseFileStatus,
  errorMessage?: string
): Promise<void> {
  const { error } = await getSupabaseClient()
    .from("study_course_files")
    .update({
      status,
      error_message: errorMessage ?? null,
      // Sert à détecter côté UI un fichier resté bloqué en "processing"
      // (onglet fermé pendant l'ingestion, par ex.) — voir
      // PROCESSING_STUCK_AFTER_MS dans app/etude/[courseId]/page.tsx.
      // Ne touche jamais next_slice_index ici : passer en "processing" est
      // aussi ce que fait un "Réessayer" sur une tranche en échec — il ne
      // faut pas reperdre la progression déjà acquise (voir
      // advanceNextSliceIndex, qui l'avance après chaque tranche réussie).
      processed_at: new Date().toISOString(),
    })
    .eq("id", fileId)

  if (error) {
    throw new Error(`Impossible de mettre à jour le statut: ${error.message}`)
  }
}

/**
 * Avance la progression après une tranche traitée avec succès — "Réessayer"
 * repart de cette tranche plutôt que de la première, évitant de retraiter
 * (et repayer) les tranches déjà acquises. Voir docs/db-anpassung.md §3.
 */
export async function advanceNextSliceIndex(fileId: string, sliceIndex: number): Promise<void> {
  const { error } = await getSupabaseClient()
    .from("study_course_files")
    .update({ next_slice_index: sliceIndex + 1 })
    .eq("id", fileId)

  if (error) {
    throw new Error(`Impossible d'enregistrer la progression: ${error.message}`)
  }
}

export async function countStudyChapters(studyCourseId: string): Promise<number> {
  const { count, error } = await getSupabaseClient()
    .from("study_chapters")
    .select("id", { count: "exact", head: true })
    .eq("study_course_id", studyCourseId)

  if (error) {
    throw new Error(`Impossible de compter les chapitres: ${error.message}`)
  }

  return count ?? 0
}

export async function listStudyCourseFiles(studyCourseId: string): Promise<StudyCourseFile[]> {
  const { data, error } = await getSupabaseClient()
    .from("study_course_files")
    .select("*")
    .eq("study_course_id", studyCourseId)
    .order("uploaded_at", { ascending: true })

  if (error) {
    throw new Error(`Impossible de charger les fichiers: ${error.message}`)
  }

  return (data ?? []) as StudyCourseFile[]
}

/** Alias de listStudyCourseFiles — utilisé par app/etude/dashboard/page.tsx. */
export const listFiles = listStudyCourseFiles

/**
 * Upload un fichier vers Supabase Storage puis enregistre la ligne
 * correspondante dans study_course_files. Utilisé par
 * app/etude/dashboard/page.tsx — combine storage.ts + createStudyCourseFile
 * pour offrir une seule fonction "upload complet" au composant.
 */
export async function uploadFile(studyCourseId: string, file: File): Promise<StudyCourseFile> {
  const { data: userData, error: userError } = await getSupabaseClient().auth.getUser()
  if (userError || !userData.user) {
    throw new Error("Utilisateur non authentifié")
  }

  const storagePath = await uploadCourseFile(userData.user.id, studyCourseId, file)
  return createStudyCourseFile(studyCourseId, file.name, storagePath, userData.user.id)
}

export async function deleteFile(studyCourseId: string, fileId: string): Promise<void> {
  const { data, error: fetchError } = await getSupabaseClient()
    .from("study_course_files")
    .select("storage_path")
    .eq("id", fileId)
    .eq("study_course_id", studyCourseId)
    .maybeSingle()

  if (fetchError) {
    throw new Error(`Impossible de charger le fichier: ${fetchError.message}`)
  }

  if (data?.storage_path) {
    await deleteCourseFile(data.storage_path)
  }

  const { error } = await getSupabaseClient()
    .from("study_course_files")
    .delete()
    .eq("id", fileId)

  if (error) {
    throw new Error(`Impossible de supprimer le fichier: ${error.message}`)
  }
}

/**
 * Enregistre le découpage en chapitres validé par l'utilisateur, met à
 * jour le profil détecté du cours, et rattache les chapitres au fichier
 * source. chapterOrderOffset permet de numéroter en continu quand un cours
 * a été ingéré en plusieurs fichiers/tranches (§5.3 étape 1).
 */
export async function saveIngestResult(
  studyCourseId: string,
  sourceFileId: string,
  ingestResult: Pick<IngestResult, "profile" | "detected_language" | "chapters">,
  chapterOrderOffset: number
): Promise<void> {
  const client = getSupabaseClient()

  const { data: userData, error: userError } = await client.auth.getUser()
  if (userError || !userData.user) {
    throw new Error("Utilisateur non authentifié")
  }

  // sourceFileId et studyCourseId viennent tous les deux du client — rien
  // côté API d'ingestion ne les recoupe (elle ne connaît que fileId, pas le
  // cours auquel le résultat sera rattaché). Sans ce contrôle, un mauvais
  // couple (fileId, courseId) attacherait silencieusement des chapitres au
  // mauvais cours de l'utilisateur.
  const { data: fileRow, error: fileCheckError } = await client
    .from("study_course_files")
    .select("study_course_id")
    .eq("id", sourceFileId)
    .maybeSingle()

  if (fileCheckError || !fileRow) {
    throw new Error("Fichier source introuvable ou accès refusé")
  }
  if (fileRow.study_course_id !== studyCourseId) {
    throw new Error("Ce fichier n'appartient pas au cours indiqué")
  }

  const { error: profileError } = await client
    .from("study_courses")
    .update({ profile: ingestResult.profile as CourseProfile, detected_lang: ingestResult.detected_language })
    .eq("id", studyCourseId)

  if (profileError) {
    throw new Error(`Impossible de mettre à jour le profil du cours: ${profileError.message}`)
  }

  const rows = ingestResult.chapters.map(chapter => ({
    study_course_id: studyCourseId,
    user_id: userData.user.id,
    order: chapter.order + chapterOrderOffset,
    title_de: chapter.title_de,
    title_fr: chapter.title_fr,
    concepts: chapter.concepts,
    summary: chapter.summary,
    has_code: chapter.has_code,
    code_lang: chapter.code_lang,
    is_organizational: chapter.is_organizational,
    source_file_id: sourceFileId,
  }))

  const { error: chaptersError } = await client.from("study_chapters").insert(rows)

  if (chaptersError) {
    // Le code Postgres (ex. 23505 = clé dupliquée sur l'ordre des chapitres,
    // deux onglets qui génèrent en parallèle) est préservé dans le message
    // pour que getApiErrorMessage puisse le traduire en texte lisible.
    throw new Error(`Impossible d'enregistrer les chapitres [${chaptersError.code ?? "?"}]: ${chaptersError.message}`)
  }
}
