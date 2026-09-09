import type { CourseProfile } from "./types"
import { getExerciseSlots } from "./exercise-strategy"

/**
 * Estimation du temps de révision d'un chapitre — PAS une mesure réelle :
 * l'app ne chronomètre aucune session aujourd'hui (aucune colonne
 * duration/elapsed nulle part, voir streak.ts qui ne dérive que des dates
 * d'activité). Le calcul est donc basé sur des ratios de temps documentés
 * dans la littérature sur l'apprentissage plutôt que sur des minutes
 * inventées au hasard :
 *
 * - Lecture active d'un concept expliqué (définition + exemple + piège) :
 *   ~60s/concept, ordre de grandeur standard pour un paragraphe technique
 *   avec exemple (~150-200 mots lus + traités, pas juste survolés).
 * - Révision d'une flashcard recto-verso avec notation (SM-2, comme Anki) :
 *   ~20-25s/carte en moyenne toutes difficultés confondues pour une carte
 *   Anki classique (définition courte). Le contenu des Lernkartei de
 *   cette app est plus riche depuis la révision du prompt (verso avec
 *   exemple concret ou piège fréquent, pas juste une définition
 *   compressée) — le temps de lecture réel s'en rapproche plutôt de
 *   celui d'une carte "cloze" détaillée, d'où 30s plutôt que 22s.
 * - Un exercice interactif complet (Speed Round, Bug Hunt, Memory...) :
 *   ~3 min en moyenne — cohérent avec un Speed Round de 8-10 questions ou
 *   un Bug Hunt/Memory d'un seul défi, plus long qu'une carte isolée mais
 *   pas une session de 15 min.
 *
 * Toujours affiché comme estimation ("~X min") jamais comme une durée
 * garantie — voir TimeRing.
 */

const SECONDS_PER_CONCEPT = 60
const SECONDS_PER_FLASHCARD = 30
const SECONDS_PER_EXERCISE = 180
/** Forfait fixe : ouverture, lecture de l'intro, navigation entre sections. */
const SECONDS_FIXED_OVERHEAD = 60

export interface ChapterTimeEstimate {
  /** Temps estimé pour lire/comprendre le cours détaillé (phase 1). */
  readingMinutes: number
  /** Temps estimé pour la série de flashcards (phase 2). */
  flashcardsMinutes: number
  /** Temps estimé pour un passage sur chaque exercice jouable (phase 3). */
  exercisesMinutes: number
  /** Somme arrondie — c'est la valeur affichée en priorité. */
  totalMinutes: number
}

/**
 * @param conceptCount nombre de concepts du chapitre (chapter.concepts.length)
 * @param profile profil du cours — détermine les exercices disponibles
 * @param hasCode chapter.has_code — détermine les exercices disponibles
 * @param realFlashcardCount nombre réel de cartes déjà générées, si connu
 *   (page chapitre, après chargement du cache) — sinon estimé à partir du
 *   nombre de concepts (la génération produit généralement une carte par
 *   concept clé, voir flashcard-prompt.ts).
 */
export function estimateChapterTime(
  conceptCount: number,
  profile: CourseProfile,
  hasCode: boolean,
  realFlashcardCount?: number,
): ChapterTimeEstimate {
  const flashcardCount = realFlashcardCount ?? Math.max(conceptCount, 3)
  const exerciseCount = getExerciseSlots(profile, hasCode).length

  const readingSeconds = SECONDS_FIXED_OVERHEAD + conceptCount * SECONDS_PER_CONCEPT
  const flashcardsSeconds = flashcardCount * SECONDS_PER_FLASHCARD
  const exercisesSeconds = exerciseCount * SECONDS_PER_EXERCISE

  const readingMinutes = Math.max(1, Math.round(readingSeconds / 60))
  const flashcardsMinutes = Math.max(1, Math.round(flashcardsSeconds / 60))
  const exercisesMinutes = Math.max(1, Math.round(exercisesSeconds / 60))

  return {
    readingMinutes,
    flashcardsMinutes,
    exercisesMinutes,
    totalMinutes: readingMinutes + flashcardsMinutes + exercisesMinutes,
  }
}
