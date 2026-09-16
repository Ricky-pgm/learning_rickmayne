import { describe, it, expect } from "vitest"
import { extractJSON } from "./ai-client"

describe("extractJSON", () => {
  it("parse un JSON strictement valide sans repli", () => {
    const result = extractJSON('{"a": 1, "b": "text"}')
    expect(result).toEqual({ a: 1, b: "text" })
  })

  it("extrait le JSON même entouré de texte parasite avant/après", () => {
    const result = extractJSON('Voici le résultat : {"a": 1} -- fin.')
    expect(result).toEqual({ a: 1 })
  })

  it("répare une virgule traînante avant une accolade fermante", () => {
    const result = extractJSON('{"a": 1, "b": 2,}')
    expect(result).toEqual({ a: 1, b: 2 })
  })

  it("répare une virgule traînante avant un crochet fermant", () => {
    const result = extractJSON('{"list": [1, 2, 3,]}')
    expect(result).toEqual({ list: [1, 2, 3] })
  })

  it("échappe un retour à la ligne brut à l'intérieur d'une chaîne", () => {
    const raw = '{"code": "line1\nline2"}'
    const result = extractJSON(raw) as { code: string }
    expect(result.code).toBe("line1\nline2")
  })

  it("n'altère pas les retours à la ligne de mise en forme hors chaînes", () => {
    const raw = '{\n  "a": 1,\n  "b": 2\n}'
    const result = extractJSON(raw)
    expect(result).toEqual({ a: 1, b: 2 })
  })

  it("laisse intacts les caractères déjà échappés (\\n littéral dans le texte source)", () => {
    const raw = '{"code": "line1\\nline2"}'
    const result = extractJSON(raw) as { code: string }
    expect(result.code).toBe("line1\nline2")
  })

  it("lève une erreur explicite si aucune accolade n'est trouvée", () => {
    expect(() => extractJSON("pas de json ici")).toThrow("Pas de JSON trouvé")
  })

  it("lève une erreur explicite si le JSON reste invalide même après réparation", () => {
    expect(() => extractJSON('{"a": ,,, invalide}')).toThrow(/JSON invalide/)
  })
})
