import { describe, it, expect } from "vitest"
import { computeStreak, highestReachedMilestone, STREAK_MILESTONES } from "./streak"

describe("computeStreak", () => {
  it("aucune activité : current=0, best=0, activeToday=false", () => {
    const result = computeStreak(new Set(), "2026-01-10")
    expect(result).toEqual({ current: 0, best: 0, activeToday: false })
  })

  it("activité aujourd'hui uniquement : streak de 1", () => {
    const result = computeStreak(new Set(["2026-01-10"]), "2026-01-10")
    expect(result.current).toBe(1)
    expect(result.activeToday).toBe(true)
  })

  it("activité hier mais pas aujourd'hui : le streak courant compte encore (grâce avant fin de journée)", () => {
    const result = computeStreak(new Set(["2026-01-09"]), "2026-01-10")
    expect(result.current).toBe(1)
    expect(result.activeToday).toBe(false)
  })

  it("streak cassé : activité il y a 2 jours seulement, current=0", () => {
    const result = computeStreak(new Set(["2026-01-08"]), "2026-01-10")
    expect(result.current).toBe(0)
    expect(result.activeToday).toBe(false)
  })

  it("streak consécutif de plusieurs jours jusqu'à aujourd'hui", () => {
    const days = new Set(["2026-01-07", "2026-01-08", "2026-01-09", "2026-01-10"])
    const result = computeStreak(days, "2026-01-10")
    expect(result.current).toBe(4)
  })

  it("best conserve le plus long streak même si le streak courant est plus court", () => {
    const days = new Set([
      "2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05", // run de 5
      "2026-01-10", // run isolé de 1 (aujourd'hui)
    ])
    const result = computeStreak(days, "2026-01-10")
    expect(result.current).toBe(1)
    expect(result.best).toBe(5)
  })

  it("best est au moins égal au streak courant même si un run passé était plus court", () => {
    const days = new Set(["2026-01-09", "2026-01-10"])
    const result = computeStreak(days, "2026-01-10")
    expect(result.best).toBe(result.current)
  })

  it("gère correctement un passage de mois (streak sur la frontière janvier/février)", () => {
    const days = new Set(["2026-01-30", "2026-01-31", "2026-02-01"])
    const result = computeStreak(days, "2026-02-01")
    expect(result.current).toBe(3)
  })
})

describe("highestReachedMilestone", () => {
  it("retourne null si aucun palier atteint", () => {
    expect(highestReachedMilestone(3)).toBeNull()
  })

  it("retourne le palier exact quand current l'atteint pile", () => {
    expect(highestReachedMilestone(5)).toBe(5)
  })

  it("retourne le plus haut palier atteint, pas le premier", () => {
    expect(highestReachedMilestone(30)).toBe(25)
  })

  it("retourne le dernier palier de la liste si current le dépasse largement", () => {
    expect(highestReachedMilestone(1000)).toBe(STREAK_MILESTONES[STREAK_MILESTONES.length - 1])
  })
})
