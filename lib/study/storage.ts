import { getSupabaseClient } from "@/lib/supabase"

const BUCKET = "study-course-files"

/**
 * Le bucket Supabase n'a ni allowed_mime_types ni file_size_limit
 * configurés (voir docs/db-anpassung.md §5) — sans cette vérification
 * côté appelant, un fichier non-PDF ou trop volumineux s'uploadait sans
 * erreur puis échouait plus tard, de façon confuse, au moment de
 * l'ingestion IA (qui attend un PDF natif). L'app n'a qu'une poignée
 * d'utilisateurs de confiance, donc le risque est plus "friction UX"
 * qu'abus, mais autant échouer tôt avec un message clair.
 */
const MAX_FILE_SIZE_BYTES = 40 * 1024 * 1024 // 40 Mo — un support de cours PDF dépasse rarement ça

export function validateCourseFile(file: File): void {
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
  if (!isPdf) {
    throw new Error("Seuls les fichiers PDF sont acceptés.")
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error(`Fichier trop volumineux (${Math.round(file.size / 1024 / 1024)} Mo, limite ${MAX_FILE_SIZE_BYTES / 1024 / 1024} Mo).`)
  }
}

/**
 * Chemin de stockage attendu par la policy RLS de 0004_study_storage.sql :
 * le premier segment doit être le user_id pour que
 * (storage.foldername(name))[1] = auth.uid()::text passe.
 */
export function buildStoragePath(userId: string, studyCourseId: string, filename: string): string {
  const safeName = filename.replace(/[^\w.\-]+/g, "_")
  return `${userId}/${studyCourseId}/${Date.now()}-${safeName}`
}

export async function uploadCourseFile(
  userId: string,
  studyCourseId: string,
  file: File
): Promise<string> {
  validateCourseFile(file)
  const path = buildStoragePath(userId, studyCourseId, file.name)
  const { error } = await getSupabaseClient().storage.from(BUCKET).upload(path, file, {
    contentType: file.type || "application/pdf",
    upsert: false,
  })

  if (error) {
    throw new Error(`Échec de l'upload: ${error.message}`)
  }

  return path
}

export async function deleteCourseFile(storagePath: string): Promise<void> {
  const { error } = await getSupabaseClient().storage.from(BUCKET).remove([storagePath])

  if (error) {
    throw new Error(`Échec de la suppression: ${error.message}`)
  }
}
