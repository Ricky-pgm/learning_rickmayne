import { describe, it, expect } from "vitest"
import { buildExamSchedule } from "./exam-schedule"
import type { StudyChapterWithCourse } from "./lesson-queries"

function chapter(overrides: Partial<StudyChapterWithCourse> & { mastery_pct: number }): StudyChapterWithCourse {
  return {
    id: `ch-${Math.random()}`,
    title_de: "Titel",
    title_fr: "Titre",
    next_review: null,
    ...overrides,
  } as StudyChapterWithCourse
}

const TODAY = new Date("2026-01-01T09:00:00")

describe("buildExamSchedule", () => {
  it("aucun jour disponible si l'examen est aujourd'hui (la veille est déjà passée)", () => {
    const chapters = [chapter({ mastery_pct: 0 })]
    expect(buildExamSchedule(chapters, "2026-01-01", TODAY)).toEqual([])
  })

  it("un seul jour disponible (aujourd'hui) si l'examen est demain", () => {
    const chapters = [chapter({ mastery_pct: 0 })]
    const schedule = buildExamSchedule(chapters, "2026-01-02", TODAY)
    expect(schedule.length).toBe(1)
    expect(schedule[0].date).toBe("2026-01-01")
  })

  it("exclut les chapitres déjà maîtrisés à 100%", () => {
    const chapters = [chapter({ mastery_pct: 100 })]
    expect(buildExamSchedule(chapters, "2026-01-10", TODAY)).toEqual([])
  })

  it("retourne un planning vide si aucun chapitre en attente", () => {
    expect(buildExamSchedule([], "2026-01-10", TODAY)).toEqual([])
  })

  it("priorise les chapitres dus (next_review dépassé) avant les autres", () => {
    const dueChapter = chapter({ mastery_pct: 50, next_review: "2025-12-31T00:00:00Z" })
    const freshChapter = chapter({ mastery_pct: 0, next_review: null })
    const schedule = buildExamSchedule([freshChapter, dueChapter], "2026-01-03", TODAY)
    expect(schedule[0].chapters[0]).toBe(dueChapter)
  })

  it("ne dépasse jamais MAX_CHAPTERS_PER_DAY (6) même avec beaucoup de chapitres et peu de jours", () => {
    const chapters = Array.from({ length: 20 }, () => chapter({ mastery_pct: 0 }))
    const schedule = buildExamSchedule(chapters, "2026-01-03", TODAY)
    for (const day of schedule) {
      expect(day.chapters.length).toBeLessThanOrEqual(6)
    }
  })

  it("répartit tous les chapitres en attente sur les jours disponibles, sans en perdre", () => {
    const chapters = Array.from({ length: 10 }, () => chapter({ mastery_pct: 0 }))
    const schedule = buildExamSchedule(chapters, "2026-01-06", TODAY) // 4 jours dispo (1,2,3,4 ; veille du 6 = 5)
    const total = schedule.reduce((sum, d) => sum + d.chapters.length, 0)
    expect(total).toBe(10)
  })

  it("le dernier jour planifié est la veille de l'examen, jamais le jour même", () => {
    const chapters = [chapter({ mastery_pct: 0 })]
    const schedule = buildExamSchedule(chapters, "2026-01-05", TODAY)
    const lastDay = schedule[schedule.length - 1].date
    expect(lastDay <= "2026-01-04").toBe(true)
  })

  it("formate les dates en YYYY-MM-DD locale (pas UTC)", () => {
    const chapters = [chapter({ mastery_pct: 0 })]
    const schedule = buildExamSchedule(chapters, "2026-01-05", TODAY)
    expect(schedule[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(schedule[0].date).toBe("2026-01-01")
  })
})
