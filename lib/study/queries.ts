import { getSupabaseClient } from "@/lib/supabase"
import { uploadCourseFile, deleteCourseFile } from "./storage"
import type { CourseProfile, StudyCourse, StudyCourseFile, StudyCourseFileStatus } from "./types"
import type { IngestResult } from "./ingest-prompt"

/**
 * Un nouveau compte (inscription publique restée ouverte) peut se
 * connecter et voir l'interface, mais ne peut pas créer de cours ni
 * uploader de fichier tant qu'il n'a pas été approuvé manuellement — voir
 * docs/db-anpassung.md §6quater. La vraie barrière est côté RLS (policy
 * INSERT sur study_courses/study_course_files), cette fonction ne sert
 * qu'à afficher le bon message côté UI avant même de tenter l'action —
 * sans elle, un compte non approuvé verrait une erreur RLS brute et
 * confuse au clic sur "Créer le cours".
 */
export async function isUserApproved(userId: string): Promise<boolean> {
  const { data, error } = await getSupabaseClient()
    .from("study_approved_users")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle()

  if (error) {
    // Fail-closed ici (pas fail-open comme le rate-limiter) : une erreur
    // réseau/RLS ne doit jamais faire passer un compte non vérifié comme
    // approuvé côté UI — au pire on affiche le message d'attente à tort,
    // jamais l'inverse. La vraie protection reste la policy RLS de toute
    // façon, ceci n'est qu'un affichage.
    return false
  }
  return data !== null
}

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
      // faut pas reperdre la progression déjà acquise (voir la RPC
      // save_ingest_result, supabase/migrations/0007, qui l'avance après
      // chaque tranche réussie).
      processed_at: new Date().toISOString(),
    })
    .eq("id", fileId)

  if (error) {
    throw new Error(`Impossible de mettre à jour le statut: ${error.message}`)
  }
}

// advanceNextSliceIndex et countStudyChapters ont existé ici — absorbées
// dans la RPC save_ingest_result (supabase/migrations/0007) pour que
// calcul d'offset + insertion + avancement de tranche soient une seule
// transaction atomique. Voir le commentaire de saveIngestResult ci-dessous.

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
 * jour le profil détecté du cours, rattache les chapitres au fichier
 * source, ET avance next_slice_index — tout dans une seule transaction
 * côté DB (RPC save_ingest_result, supabase/migrations/0007), pas trois
 * appels séparés comme avant (count → insert → update).
 *
 * Corrige deux bugs confirmés par l'audit sécurité :
 * - Race condition (C-3) : l'offset de numérotation était calculé côté
 *   client (SELECT count(*) séparé, sans transaction) — deux ingestions
 *   concurrentes sur le même cours pouvaient lire le même compte et
 *   tenter d'insérer les mêmes "order", faisant échouer tout le lot après
 *   avoir déjà payé la tranche Sonnet. La RPC verrouille la ligne du
 *   cours (SELECT ... FOR UPDATE) pendant le calcul + l'insertion, ce qui
 *   sérialise les appels concurrents au lieu de les laisser courir en
 *   parallèle sur une valeur périmée — vérifié réellement avec deux
 *   transactions concurrentes sur une instance Postgres locale : aucune
 *   collision, aucune perte, la deuxième attend la première.
 * - Non-idempotence (F-2) : si l'avancement de next_slice_index (alors un
 *   appel séparé, advanceNextSliceIndex) échouait après que les chapitres
 *   aient déjà été insérés (réseau coupé — le cas le plus probable en
 *   plein milieu d'une ingestion longue), un "Réessayer" rejouait (et
 *   repayait) la même tranche Sonnet et dupliquait ses chapitres sous un
 *   nouvel offset. Les deux opérations sont maintenant dans la même
 *   transaction : l'une ne peut plus réussir sans l'autre.
 *
 * sliceIndex identifie la tranche en cours (0-based, voir
 * lib/study/pdf-split.ts) — la RPC avance next_slice_index à
 * sliceIndex + 1, même sémantique que l'ancien advanceNextSliceIndex.
 */
export async function saveIngestResult(
  studyCourseId: string,
  sourceFileId: string,
  ingestResult: Pick<IngestResult, "profile" | "detected_language" | "chapters">,
  sliceIndex: number
): Promise<void> {
  const { error } = await getSupabaseClient().rpc("save_ingest_result", {
    p_study_course_id: studyCourseId,
    p_source_file_id: sourceFileId,
    p_profile: ingestResult.profile,
    p_detected_lang: ingestResult.detected_language,
    p_chapters: ingestResult.chapters,
    p_slice_index: sliceIndex,
  })

  if (error) {
    // Le message de la RPC (ex. "Ce fichier n'appartient pas au cours
    // indiqué") est déjà lisible tel quel — pas de code Postgres à
    // traduire ici, contrairement à l'ancien insert direct où 23505
    // (collision d'ordre) pouvait remonter : cette collision n'est plus
    // possible, la RPC calcule l'offset sous verrou.
    throw new Error(`Impossible d'enregistrer les chapitres: ${error.message}`)
  }
}
