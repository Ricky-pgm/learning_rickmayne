import type { CourseProfile, StudyExerciseType } from "./types"

interface ExerciseSlot {
  type: StudyExerciseType
  weight: number
  requires_code: boolean
}

export function getExerciseSlots(profile: CourseProfile, hasCode: boolean): ExerciseSlot[] {
  switch (profile) {
    case "programming": {
      // matching/conceptMap avec un poids non nul même en programmation :
      // un chapitre d'intro/contexte sans code (has_code: false) dans un
      // cours de programmation ne se réduisait sinon qu'à speedRound +
      // fillBlank une fois code/bugHunt/codeAnalysis filtrés — un vrai
      // appauvrissement des exercices jouables pour ce cas, fréquent
      // (premier chapitre d'un cours, présentation du langage...).
      const slots: ExerciseSlot[] = [
        { type: "speedRound",   weight: 0.18, requires_code: false },
        { type: "code",         weight: 0.22, requires_code: true },
        { type: "bugHunt",      weight: 0.18, requires_code: true },
        { type: "fillBlank",    weight: 0.13, requires_code: false },
        { type: "mcq",          weight: 0.09, requires_code: false },
        { type: "codeAnalysis", weight: 0.09, requires_code: true },
        { type: "matching",     weight: 0.06, requires_code: false },
        { type: "conceptMap",   weight: 0.05, requires_code: false },
      ]
      return slots.filter(s => !s.requires_code || hasCode)
    }

    case "theory": {
      const slots: ExerciseSlot[] = [
        { type: "speedRound",  weight: 0.20, requires_code: false },
        { type: "mcq",         weight: 0.25, requires_code: false },
        { type: "matching",    weight: 0.20, requires_code: false },
        { type: "trueFalse",   weight: 0.15, requires_code: false },
        { type: "fillBlank",   weight: 0.10, requires_code: false },
        { type: "conceptMap",  weight: 0.10, requires_code: false },
      ]
      return slots
    }

    case "mixed": {
      const slots: ExerciseSlot[] = [
        { type: "speedRound",   weight: 0.15, requires_code: false },
        { type: "mcq",          weight: 0.15, requires_code: false },
        { type: "code",         weight: 0.15, requires_code: true },
        { type: "matching",     weight: 0.10, requires_code: false },
        { type: "trueFalse",    weight: 0.10, requires_code: false },
        { type: "bugHunt",      weight: 0.10, requires_code: true },
        { type: "fillBlank",    weight: 0.10, requires_code: false },
        { type: "conceptMap",   weight: 0.05, requires_code: false },
      ]
      return slots.filter(s => !s.requires_code || hasCode)
    }
  }
}

export function pickRandomExerciseType(slots: ExerciseSlot[]): StudyExerciseType {
  const total = slots.reduce((s, slot) => s + slot.weight, 0)
  let rand = Math.random() * total
  for (const slot of slots) {
    rand -= slot.weight
    if (rand <= 0) return slot.type
  }
  return slots[slots.length - 1].type
}
