export type Grade = "again" | "hard" | "good" | "easy"

export interface ReviewState {
  intervalDays: number
  easeFactor: number
  dueAt: string
  reviews: number
}

const MIN_EASE = 1.3
const DEFAULT_EASE = 2.5

// Sans plafond, des "easy" répétés multiplient l'interval par ease*1.3 à
// chaque révision (croissance exponentielle) — après ~20 répétitions
// l'interval dépasse 10^11 jours et Date.setUTCDate produit une date
// invalide (RangeError plus loin dans addDays). Deux ans dépasse déjà
// largement l'horizon utile d'une révision espacée.
const MAX_INTERVAL_DAYS = 730

function addDays(from: Date, days: number): Date {
  const result = new Date(from)
  result.setUTCDate(result.getUTCDate() + days)
  return result
}

/**
 * SM-2 simplifié : calcule le prochain état d'une carte après un grade.
 * Logique pure, pas d'effet de bord, testable sans mock. `now` est injecté
 * pour rester testable avec des dates simulées ; `state` est `null` pour
 * une carte jamais révisée (première révision).
 *
 * - again : on recommence (interval = 1), ease baisse
 * - hard : interval × 1.2, ease baisse légèrement
 * - good : interval × ease_factor, ease stable ou léger bonus
 * - easy : interval × ease_factor × 1.3, ease augmente
 */
export function scheduleNext(
  state: ReviewState | null,
  grade: Grade,
  now: Date = new Date()
): ReviewState {
  const current = state ?? { intervalDays: 0, easeFactor: DEFAULT_EASE, dueAt: now.toISOString(), reviews: 0 }
  const { intervalDays, easeFactor, reviews } = current

  switch (grade) {
    case "again":
      return {
        intervalDays: 1,
        easeFactor: Math.max(MIN_EASE, easeFactor - 0.2),
        dueAt: addDays(now, 1).toISOString(),
        reviews: reviews + 1,
      }

    case "hard": {
      const nextInterval = Math.min(MAX_INTERVAL_DAYS, Math.max(1, Math.ceil(intervalDays * 1.2)))
      return {
        intervalDays: nextInterval,
        easeFactor: Math.max(MIN_EASE, easeFactor - 0.15),
        dueAt: addDays(now, nextInterval).toISOString(),
        reviews: reviews + 1,
      }
    }

    case "good": {
      const newEase = reviews === 0 ? easeFactor : Math.min(easeFactor + 0.05, 3.0)
      const nextInterval = Math.min(MAX_INTERVAL_DAYS, Math.max(1, Math.ceil(intervalDays * easeFactor)))
      return {
        intervalDays: nextInterval,
        easeFactor: newEase,
        dueAt: addDays(now, nextInterval).toISOString(),
        reviews: reviews + 1,
      }
    }

    case "easy": {
      const nextInterval = Math.min(MAX_INTERVAL_DAYS, Math.max(1, Math.ceil(intervalDays * easeFactor * 1.3)))
      return {
        intervalDays: nextInterval,
        easeFactor: Math.min(easeFactor + 0.15, 3.0),
        dueAt: addDays(now, nextInterval).toISOString(),
        reviews: reviews + 1,
      }
    }
  }
}

export function isDue(state: ReviewState, now: Date = new Date()): boolean {
  return new Date(state.dueAt).getTime() <= now.getTime()
}
