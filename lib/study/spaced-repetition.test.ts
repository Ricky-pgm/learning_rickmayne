import { describe, it, expect } from "vitest"
import { scheduleNext, isDue, type ReviewState } from "./spaced-repetition"

const FIXED_NOW = new Date("2026-01-10T12:00:00Z")

describe("scheduleNext", () => {
  it("première révision, grade again : interval=1, ease baisse depuis le défaut", () => {
    const result = scheduleNext(null, "again", FIXED_NOW)
    expect(result.intervalDays).toBe(1)
    expect(result.easeFactor).toBeCloseTo(2.3)
    expect(result.reviews).toBe(1)
    expect(result.dueAt).toBe(new Date("2026-01-11T12:00:00Z").toISOString())
  })

  it("première révision, grade good : intervalDays initial 0 donne le plancher (1)", () => {
    const result = scheduleNext(null, "good", FIXED_NOW)
    expect(result.intervalDays).toBe(1) // max(1, ceil(0 * 2.5))
    expect(result.easeFactor).toBe(2.5) // reviews===0 : ease inchangé
  })

  it("grade hard multiplie l'interval par 1.2 et arrondit au-dessus", () => {
    const state: ReviewState = { intervalDays: 10, easeFactor: 2.5, dueAt: FIXED_NOW.toISOString(), reviews: 3 }
    const result = scheduleNext(state, "hard", FIXED_NOW)
    expect(result.intervalDays).toBe(12) // ceil(10 * 1.2)
    expect(result.easeFactor).toBeCloseTo(2.35)
  })

  it("grade easy augmente l'ease et multiplie l'interval par ease*1.3", () => {
    const state: ReviewState = { intervalDays: 5, easeFactor: 2.5, dueAt: FIXED_NOW.toISOString(), reviews: 3 }
    const result = scheduleNext(state, "easy", FIXED_NOW)
    expect(result.intervalDays).toBe(Math.ceil(5 * 2.5 * 1.3))
    expect(result.easeFactor).toBeCloseTo(2.65)
  })

  it("ease ne descend jamais sous MIN_EASE (1.3) même après plusieurs 'again'", () => {
    let state: ReviewState | null = null
    for (let i = 0; i < 20; i++) {
      state = scheduleNext(state, "again", FIXED_NOW)
    }
    expect(state!.easeFactor).toBeGreaterThanOrEqual(1.3)
  })

  it("ease ne dépasse jamais 3.0, et l'interval reste plafonné même après beaucoup de 'easy'", () => {
    let state: ReviewState | null = null
    for (let i = 0; i < 20; i++) {
      state = scheduleNext(state, "easy", FIXED_NOW)
    }
    expect(state!.easeFactor).toBeLessThanOrEqual(3.0)
    expect(state!.intervalDays).toBeLessThanOrEqual(730)
    expect(() => new Date(state!.dueAt).toISOString()).not.toThrow()
  })

  it("interval reste toujours >= 1 même à partir de intervalDays=0", () => {
    const state: ReviewState = { intervalDays: 0, easeFactor: 2.5, dueAt: FIXED_NOW.toISOString(), reviews: 0 }
    for (const grade of ["again", "hard", "good", "easy"] as const) {
      const result = scheduleNext(state, grade, FIXED_NOW)
      expect(result.intervalDays).toBeGreaterThanOrEqual(1)
    }
  })

  it("le compteur reviews s'incrémente à chaque appel", () => {
    const state: ReviewState = { intervalDays: 5, easeFactor: 2.5, dueAt: FIXED_NOW.toISOString(), reviews: 7 }
    const result = scheduleNext(state, "good", FIXED_NOW)
    expect(result.reviews).toBe(8)
  })
})

describe("isDue", () => {
  it("retourne true si dueAt est dans le passé", () => {
    const state: ReviewState = { intervalDays: 1, easeFactor: 2.5, dueAt: "2026-01-01T00:00:00Z", reviews: 1 }
    expect(isDue(state, FIXED_NOW)).toBe(true)
  })

  it("retourne false si dueAt est dans le futur", () => {
    const state: ReviewState = { intervalDays: 1, easeFactor: 2.5, dueAt: "2026-02-01T00:00:00Z", reviews: 1 }
    expect(isDue(state, FIXED_NOW)).toBe(false)
  })

  it("retourne true si dueAt est exactement now", () => {
    const state: ReviewState = { intervalDays: 1, easeFactor: 2.5, dueAt: FIXED_NOW.toISOString(), reviews: 1 }
    expect(isDue(state, FIXED_NOW)).toBe(true)
  })
})
