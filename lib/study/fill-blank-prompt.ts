import type { StudyChapter } from "./types"

export interface FillBlankChallenge {
  text_template: string
  blanks: string[]
  distractors: string[]
}

// 2-3 trous : assez pour tester la compréhension sans rendre la phrase
// illisible ni le pool d'étiquettes trop grand à parcourir sur mobile.
const MIN_BLANKS = 2
const MAX_BLANKS = 3

/**
 * Prompt du Texte à trous — une courte explication du chapitre avec des
 * mots-clés retirés, à replacer en cliquant une étiquette puis un trou
 * (pas de saisie libre, voir components/study/exercises/fill-blank.tsx —
 * évite la frustration d'une formulation proche mais jugée fausse).
 * Génération Haiku, jamais mise en cache, comme les autres mini-jeux.
 */
export function buildFillBlankPrompt(
  chapter: Pick<StudyChapter, "title_de" | "concepts" | "summary">
): string {
  const conceptList = chapter.concepts.join(", ")

  return `Génère un texte à trous pour réviser le chapitre "${chapter.title_de}".

Résumé : ${chapter.summary}
Concepts : ${conceptList}

Écris 1 à 2 phrases courtes en français qui expliquent un point clé du chapitre, avec ${MIN_BLANKS} à ${MAX_BLANKS} mots-clés retirés et remplacés par des marqueurs [1], [2], [3] dans l'ordre. Chaque mot-clé retiré doit être un terme précis et important (pas un mot banal comme "le" ou "est"), idéalement un des concepts listés ci-dessus ou un terme technique du résumé.

La phrase doit se déduire directement du résumé fourni — n'ajoute aucun fait précis (chiffre, date, nom propre, norme) qui n'y figure pas déjà, même s'il te semble vrai de ta connaissance générale : un étudiant qui réviserait sur une affirmation non enseignée par son cours serait induit en erreur.

Fournis aussi 2 à 3 mots "distracteurs" : des termes plausibles dans le même registre que les bonnes réponses, mais clairement faux à cet endroit précis — pas des mots aléatoires sans rapport.

Réponds UNIQUEMENT avec du JSON valide, sans markdown, sans backticks :
{
  "text_template": "Phrase avec [1] et [2] à la place des mots retirés.",
  "blanks": ["mot retiré pour [1]", "mot retiré pour [2]"],
  "distractors": ["terme plausible mais faux", "autre terme plausible mais faux"]
}`
}
