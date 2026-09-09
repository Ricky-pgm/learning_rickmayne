import { getSupabaseClient } from "@/lib/supabase"
import type { Flashcard, FlashcardGrade, FlashcardProgress } from "./types"
import type { GeneratedFlashcard } from "./flashcard-prompt"
import type { ReviewState } from "./spaced-repetition"

/**
 * Cache-first, comme lesson-queries.ts : study_flashcards n'est jamais
 * régénéré automatiquement une fois créé pour un chapitre.
 */
export async function getCachedFlashcards(studyChapterId: string): Promise<Flashcard[]> {
  const { data, error } = await getSupabaseClient()
    .from("study_flashcards")
    .select("*")
    .eq("study_chapter_id", studyChapterId)

  if (error) {
    throw new Error(`Impossible de charger les flashcards: ${error.message}`)
  }

  return (data ?? []) as Flashcard[]
}

export async function saveFlashcards(studyChapterId: string, cards: GeneratedFlashcard[]): Promise<Flashcard[]> {
  const client = getSupabaseClient()
  const { data: userData, error: userError } = await client.auth.getUser()
  if (userError || !userData.user) {
    throw new Error("Utilisateur non authentifié")
  }

  const rows = cards.map(c => ({
    study_chapter_id: studyChapterId,
    user_id: userData.user.id,
    front_de: c.front_de,
    back_de: c.back_de,
    back_fr: c.back_fr,
  }))

  const { data, error } = await client
    .from("study_flashcards")
    .insert(rows)
    .select()

  if (error) {
    throw new Error(`Impossible d'enregistrer les flashcards: ${error.message}`)
  }

  return (data ?? []) as Flashcard[]
}

export async function getFlashcardProgress(
  userId: string,
  flashcardId: string
): Promise<ReviewState | null> {
  const { data, error } = await getSupabaseClient()
    .from("study_flashcards_progress")
    .select("interval_days, ease_factor, due_at, reviews")
    .eq("user_id", userId)
    .eq("flashcard_id", flashcardId)
    .maybeSingle()

  if (error) {
    throw new Error(`Impossible de charger la progression: ${error.message}`)
  }

  if (!data) return null

  return {
    intervalDays: data.interval_days,
    easeFactor: Number(data.ease_factor),
    dueAt: data.due_at,
    reviews: data.reviews,
  }
}

export async function listDueFlashcards(
  userId: string,
  studyChapterIds: string[],
  now: Date = new Date()
): Promise<FlashcardProgress[]> {
  if (studyChapterIds.length === 0) return []

  const { data: cards, error: cardsError } = await getSupabaseClient()
    .from("study_flashcards")
    .select("id")
    .in("study_chapter_id", studyChapterIds)

  if (cardsError) {
    throw new Error(`Impossible de charger les cartes: ${cardsError.message}`)
  }

  const cardIds = (cards ?? []).map(c => c.id)
  if (cardIds.length === 0) return []

  const { data, error } = await getSupabaseClient()
    .from("study_flashcards_progress")
    .select("*")
    .eq("user_id", userId)
    .in("flashcard_id", cardIds)
    .lte("due_at", now.toISOString())

  if (error) {
    throw new Error(`Impossible de charger les cartes dues: ${error.message}`)
  }

  return (data ?? []) as FlashcardProgress[]
}

export async function saveFlashcardProgress(
  userId: string,
  flashcardId: string,
  state: ReviewState,
  grade: FlashcardGrade
): Promise<void> {
  const { error } = await getSupabaseClient()
    .from("study_flashcards_progress")
    .upsert({
      user_id: userId,
      flashcard_id: flashcardId,
      interval_days: state.intervalDays,
      ease_factor: state.easeFactor,
      due_at: state.dueAt,
      last_grade: grade,
      // BUG CRITIQUE corrigé : reviews n'était jamais écrit ici alors que
      // scheduleNext le calcule bien (reviews + 1) — la colonne restait
      // donc à son default 0 pour toujours, quel que soit le nombre réel
      // de révisions. study_chapters_with_progress filtre explicitement
      // sur `p.reviews > 0` pour mastery_pct ET next_review : avec ce bug,
      // AUCUNE carte ne pouvait jamais compter comme "maîtrisée" ni
      // apparaître "à réviser", pour personne, peu importe l'usage réel.
      reviews: state.reviews,
      updated_at: new Date().toISOString(),
    })

  if (error) {
    throw new Error(`Impossible d'enregistrer la progression: ${error.message}`)
  }
}
