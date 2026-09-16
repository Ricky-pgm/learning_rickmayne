import { describe, it, expect } from "vitest"
import { validateChapters, type RawChapterCandidate } from "./validate-chapters"

function chapter(overrides: Partial<RawChapterCandidate>): RawChapterCandidate {
  return {
    order: 1,
    title_de: "Kapitel",
    title_fr: "Chapitre",
    concepts: ["variable"],
    summary: "Ce chapitre parle de la variable en détail.",
    has_code: false,
    ...overrides,
  }
}

describe("validateChapters", () => {
  it("aucune anomalie sur des chapitres bien formés", () => {
    const chapters = [
      chapter({ order: 1, title_de: "A", title_fr: "A", concepts: ["boucle"], summary: "La boucle est un concept clé." }),
      chapter({ order: 2, title_de: "B", title_fr: "B", concepts: ["fonction"], summary: "La fonction est réutilisable." }),
    ]
    expect(validateChapters(chapters)).toEqual([])
  })

  it("détecte un titre manquant (DE ou FR)", () => {
    const chapters = [chapter({ title_de: "  ", title_fr: "Chapitre" })]
    const issues = validateChapters(chapters)
    expect(issues.some(i => i.kind === "missing_title")).toBe(true)
  })

  it("détecte l'absence de concepts", () => {
    const chapters = [chapter({ concepts: [] })]
    const issues = validateChapters(chapters)
    expect(issues.some(i => i.kind === "no_concepts")).toBe(true)
  })

  it("détecte un titre dupliqué (insensible à la casse) entre deux chapitres", () => {
    const chapters = [
      chapter({ order: 1, title_de: "Schleifen" }),
      chapter({ order: 2, title_de: "schleifen" }),
    ]
    const issues = validateChapters(chapters)
    expect(issues.some(i => i.kind === "duplicate_title" && i.chapterOrder === 2)).toBe(true)
  })

  it("détecte un concept qui n'apparaît pas dans le résumé (orphelin)", () => {
    const chapters = [chapter({ concepts: ["polymorphisme"], summary: "Ce chapitre ne mentionne rien de tel." })]
    const issues = validateChapters(chapters)
    expect(issues.some(i => i.kind === "orphan_concept")).toBe(true)
  })

  it("n'alerte pas sur un concept orphelin trop court (<= 2 caractères, bruit probable)", () => {
    const chapters = [chapter({ concepts: ["if"], summary: "Résumé sans rapport direct." })]
    const issues = validateChapters(chapters)
    expect(issues.some(i => i.kind === "orphan_concept")).toBe(false)
  })

  it("détecte une rupture dans la numérotation des chapitres (order_gap)", () => {
    const chapters = [
      chapter({ order: 1 }),
      chapter({ order: 3 }),
    ]
    const issues = validateChapters(chapters)
    expect(issues.some(i => i.kind === "order_gap" && i.chapterOrder === 3)).toBe(true)
  })

  it("ne signale pas d'order_gap pour une numérotation continue", () => {
    const chapters = [chapter({ order: 1 }), chapter({ order: 2 }), chapter({ order: 3 })]
    const issues = validateChapters(chapters)
    expect(issues.some(i => i.kind === "order_gap")).toBe(false)
  })

  it("un chapitre peut accumuler plusieurs anomalies simultanément", () => {
    const chapters = [chapter({ title_de: "", concepts: [] })]
    const issues = validateChapters(chapters)
    expect(issues.length).toBeGreaterThanOrEqual(2)
  })
})
