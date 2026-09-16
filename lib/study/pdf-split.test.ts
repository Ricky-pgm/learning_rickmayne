import { describe, it, expect } from "vitest"
import { groupChapterStartsIntoSlices } from "./pdf-split"

describe("groupChapterStartsIntoSlices", () => {
  it("un seul chapitre couvrant tout le document sous le seuil : une seule tranche", () => {
    const slices = groupChapterStartsIntoSlices([1], 30, 45)
    expect(slices).toEqual([{ startPage: 1, endPage: 30 }])
  })

  it("ajoute une frontière implicite à la page 1 si absente", () => {
    const slices = groupChapterStartsIntoSlices([10], 30, 45)
    expect(slices[0].startPage).toBe(1)
  })

  it("ne coupe jamais un chapitre en deux : chaque tranche commence exactement sur une frontière connue", () => {
    const starts = [1, 20, 40, 60]
    const slices = groupChapterStartsIntoSlices(starts, 80, 25)
    for (const slice of slices) {
      expect(starts).toContain(slice.startPage)
    }
  })

  it("les tranches sont contiguës et couvrent tout le document sans trou ni chevauchement", () => {
    const starts = [1, 15, 30, 50, 70]
    const slices = groupChapterStartsIntoSlices(starts, 90, 20)
    expect(slices[0].startPage).toBe(1)
    expect(slices[slices.length - 1].endPage).toBe(90)
    for (let i = 1; i < slices.length; i++) {
      expect(slices[i].startPage).toBe(slices[i - 1].endPage + 1)
    }
  })

  it("regroupe plusieurs chapitres courts consécutifs dans une même tranche sous le seuil", () => {
    const starts = [1, 5, 10, 15]
    const slices = groupChapterStartsIntoSlices(starts, 20, 45)
    expect(slices.length).toBe(1)
    expect(slices[0]).toEqual({ startPage: 1, endPage: 20 })
  })

  it("un chapitre isolé plus long que maxPagesPerSlice devient sa propre tranche surdimensionnée plutôt que d'être coupé", () => {
    // starts[i-1] === sliceStart : la garde qui empêche de couper un chapitre en deux
    const slices = groupChapterStartsIntoSlices([1, 100], 150, 45)
    expect(slices.some(s => s.endPage - s.startPage + 1 > 45)).toBe(true)
  })

  it("déduplique et trie des frontières désordonnées avec doublons", () => {
    const slices = groupChapterStartsIntoSlices([30, 1, 30, 15], 40, 45)
    expect(slices).toEqual([{ startPage: 1, endPage: 40 }])
  })

  it("ignore les frontières hors limites (0, négatives, ou > totalPages)", () => {
    const slices = groupChapterStartsIntoSlices([0, -5, 1, 200], 50, 45)
    expect(slices[slices.length - 1].endPage).toBe(50)
    for (const slice of slices) {
      expect(slice.startPage).toBeGreaterThanOrEqual(1)
      expect(slice.endPage).toBeLessThanOrEqual(50)
    }
  })
})
