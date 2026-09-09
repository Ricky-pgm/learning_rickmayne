import { getSupabaseClient } from "@/lib/supabase"

/**
 * Streak de jours consécutifs de révision — mécanisme de motivation le
 * plus efficace du plan d'origine (docs/plan-implementation.md §3c,
 * "streak sur plusieurs jours, milestone à 5/10/25/50"), jamais
 * implémenté : le seul "streak" existant avant ce module ne durait qu'une
 * session (bonnes réponses d'affilée en Speed Round/flashcards).
 *
 * Pas de nouvelle table : une "journée d'activité" est dérivée des deux
 * sources déjà écrites à chaque révision — study_flashcards_progress
 * (updated_at, écrit à chaque notation SM-2) et study_exercise_history
 * (answered_at, écrit à chaque réponse Speed Round).
 */

export interface StudyStreak {
  /** Jours consécutifs jusqu'à aujourd'hui (0 si rien fait aujourd'hui ni hier). */
  current: number
  /** Le plus long streak jamais atteint, sur tout l'historique disponible. */
  best: number
  /** true si une activité a déjà eu lieu aujourd'hui. */
  activeToday: boolean
}

/** Paliers de célébration — mêmes valeurs que le plan d'origine (§3c). */
export const STREAK_MILESTONES = [5, 10, 25, 50, 100] as const

/** Le plus grand palier atteint par `current`, ou null si aucun. */
export function highestReachedMilestone(current: number): number | null {
  const reached = STREAK_MILESTONES.filter(m => current >= m)
  return reached.length > 0 ? reached[reached.length - 1] : null
}

/**
 * Convertit un timestamp DB (toujours en UTC) en clé de jour LOCALE —
 * "2026-09-02T23:30:00Z" doit compter comme le 3 (pas le 2) pour un
 * utilisateur en UTC+2 qui révise à 1h30 du matin chez lui. slice(0, 10)
 * sur l'ISO brut (bug corrigé) restait en UTC : un étudiant qui révise
 * tard le soir ou tôt le matin pouvait voir son streak cassé ou avancé
 * au mauvais jour de son propre calendrier. Même correction que
 * toISODate dans exam-schedule.ts.
 */
function toDayKey(iso: string): string {
  const d = new Date(iso)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

// addDays/todayKey manipulent des clés déjà en calendrier local (voir
// toDayKey) — construits et lus en LOCAL (pas UTC) pour rester cohérents
// avec elles, jamais mélanger les deux référentiels sur les mêmes clés.
function addDays(dayKey: string, delta: number): string {
  const [year, month, day] = dayKey.split("-").map(Number)
  const d = new Date(year, month - 1, day)
  d.setDate(d.getDate() + delta)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${dd}`
}

/**
 * Calcul pur à partir d'un ensemble de jours actifs (clés "YYYY-MM-DD") et
 * du jour courant — séparé de la requête DB pour rester testable sans
 * dépendance réseau/horloge système imprévisible.
 */
export function computeStreak(activeDays: Set<string>, todayKey: string): StudyStreak {
  const activeToday = activeDays.has(todayKey)

  // Le streak courant part d'aujourd'hui s'il y a une activité aujourd'hui,
  // sinon d'hier (ne casse pas le streak avant la fin de la journée) —
  // sinon 0.
  let cursor = activeToday ? todayKey : addDays(todayKey, -1)
  let current = 0
  if (activeDays.has(cursor)) {
    while (activeDays.has(cursor)) {
      current++
      cursor = addDays(cursor, -1)
    }
  }

  // Meilleur streak historique : parcourt tous les jours actifs triés,
  // compte les runs consécutifs.
  const sorted = Array.from(activeDays).sort()
  let best = 0
  let run = 0
  let prev: string | null = null
  for (const day of sorted) {
    run = prev !== null && addDays(prev, 1) === day ? run + 1 : 1
    best = Math.max(best, run)
    prev = day
  }

  return { current, best: Math.max(best, current), activeToday }
}

export async function getStudyStreak(userId: string): Promise<StudyStreak> {
  const client = getSupabaseClient()

  const [flashcardDates, exerciseDates] = await Promise.all([
    client
      .from("study_flashcards_progress")
      .select("updated_at")
      .eq("user_id", userId),
    client
      .from("study_exercise_history")
      .select("answered_at")
      .eq("user_id", userId),
  ])

  if (flashcardDates.error) {
    throw new Error(`Impossible de charger le streak: ${flashcardDates.error.message}`)
  }
  if (exerciseDates.error) {
    throw new Error(`Impossible de charger le streak: ${exerciseDates.error.message}`)
  }

  const activeDays = new Set<string>()
  for (const row of flashcardDates.data ?? []) activeDays.add(toDayKey(row.updated_at))
  for (const row of exerciseDates.data ?? []) activeDays.add(toDayKey(row.answered_at))

  // toDayKey(new Date().toISOString()) plutôt qu'un slice direct — passe
  // par la même conversion locale que les jours d'activité, sinon on
  // comparerait un "aujourd'hui" en UTC à des jours calculés en local.
  const todayKey = toDayKey(new Date().toISOString())
  return computeStreak(activeDays, todayKey)
}
