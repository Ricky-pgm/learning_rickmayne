import { describe, it, expect } from "vitest"
import { pickNextExercise, type NextUpCandidate } from "./next-up"
import type { ExerciseHistoryEntry, ExerciseTypeWeight } from "./types"

function entry(overrides: Partial<ExerciseHistoryEntry>): ExerciseHistoryEntry {
  return {
    study_chapter_id: "ch1",
    exercise_type: "flashcards",
    correct: true,
    answered_at: "2026-01-01T00:00:00Z",
    ...overrides,
  }
}

describe("pickNextExercise", () => {
  it("retourne null si aucun candidat", () => {
    expect(pickNextExercise([], [], [])).toBeNull()
  })

  it("un seul candidat est toujours choisi, quel que soit l'historique", () => {
    const candidates: NextUpCandidate[] = [{ studyChapterId: "ch1", exerciseType: "flashcards" }]
    expect(pickNextExercise(candidates, [], [])).toEqual(candidates[0])
  })

  it("favorise un chapitre jamais pratiqué face à un chapitre déjà réussi à 100%", () => {
    const candidates: NextUpCandidate[] = [
      { studyChapterId: "practiced", exerciseType: "flashcards" },
      { studyChapterId: "never", exerciseType: "flashcards" },
    ]
    const history: ExerciseHistoryEntry[] = [
      entry({ study_chapter_id: "practiced", correct: true }),
      entry({ study_chapter_id: "practiced", correct: true }),
      entry({ study_chapter_id: "practiced", correct: true }),
      entry({ study_chapter_id: "practiced", correct: true }),
    ]
    const result = pickNextExercise(candidates, [], history)
    expect(result?.studyChapterId).toBe("never")
  })

  it("favorise un type d'exercice avec un taux d'échec élevé (>= 3 tentatives) par rapport à un type toujours réussi", () => {
    const candidates: NextUpCandidate[] = [
      { studyChapterId: "ch1", exerciseType: "flashcards" },
      { studyChapterId: "ch1", exerciseType: "speedRound" },
    ]
    const history: ExerciseHistoryEntry[] = [
      entry({ exercise_type: "flashcards", correct: true }),
      entry({ exercise_type: "flashcards", correct: true }),
      entry({ exercise_type: "flashcards", correct: true }),
      entry({ exercise_type: "speedRound", correct: false }),
      entry({ exercise_type: "speedRound", correct: false }),
      entry({ exercise_type: "speedRound", correct: false }),
    ]
    const result = pickNextExercise(candidates, [], history)
    expect(result?.exerciseType).toBe("speedRound")
  })

  it("ignore le taux d'échec sous le seuil minimal de tentatives (< 3) et applique le poids de base", () => {
    const candidates: NextUpCandidate[] = [
      { studyChapterId: "ch1", exerciseType: "flashcards" },
      { studyChapterId: "ch1", exerciseType: "speedRound" },
    ]
    // speedRound a un échec à 100% mais seulement 1 tentative (< MIN_ATTEMPTS_FOR_ERROR_SIGNAL) —
    // ne doit pas déclencher le boost d'erreur, score = baseWeight simple.
    const history: ExerciseHistoryEntry[] = [
      entry({ exercise_type: "speedRound", correct: false }),
    ]
    const mix: ExerciseTypeWeight[] = [
      { exerciseType: "flashcards", weight: 5 },
      { exerciseType: "speedRound", weight: 1 },
    ]
    const result = pickNextExercise(candidates, mix, history)
    expect(result?.exerciseType).toBe("flashcards")
  })

  it("respecte le poids du mix par défaut quand l'historique est vide", () => {
    const candidates: NextUpCandidate[] = [
      { studyChapterId: "ch1", exerciseType: "flashcards" },
      { studyChapterId: "ch1", exerciseType: "speedRound" },
    ]
    const mix: ExerciseTypeWeight[] = [
      { exerciseType: "flashcards", weight: 1 },
      { exerciseType: "speedRound", weight: 10 },
    ]
    const result = pickNextExercise(candidates, mix, [])
    expect(result?.exerciseType).toBe("speedRound")
  })
})
