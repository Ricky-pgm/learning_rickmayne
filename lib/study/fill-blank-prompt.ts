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
 *
 * Entièrement en ALLEMAND (phrase, mots-clés ET distracteurs) — pas de
 * mélange de langues comme avant. `chapter.concepts`/`summary` sont déjà en
 * allemand (vocabulaire d'examen réel), donc demander une phrase "en
 * français" tout en retirant des mots-clés piochés dans ce contenu allemand
 * produisait mécaniquement un mélange (squelette français, mots-clés
 * allemands sans traduction naturelle en contexte) — signalé par Ricky
 * comme peu clair ("nachvollziehen" compliqué). Même logique que
 * front_de/back_de des flashcards : une seule langue de bout en bout par
 * exercice plutôt qu'une traduction forcée qui perdrait le vrai terme
 * d'examen.
 */
export function buildFillBlankPrompt(
  chapter: Pick<StudyChapter, "title_de" | "concepts" | "summary">
): string {
  const conceptList = chapter.concepts.join(", ")

  return `Generiere einen Lückentext zur Wiederholung des Kapitels "${chapter.title_de}".

Zusammenfassung: ${chapter.summary}
Konzepte: ${conceptList}

Schreibe 1 bis 2 kurze Sätze auf DEUTSCH, die einen zentralen Punkt des Kapitels erklären, mit ${MIN_BLANKS} bis ${MAX_BLANKS} entfernten Schlüsselbegriffen, ersetzt durch die Marker [1], [2], [3] in dieser Reihenfolge. Jeder entfernte Begriff muss ein präzises und wichtiges Fachwort sein (kein banales Wort wie "der" oder "ist") — idealerweise eines der oben gelisteten Konzepte oder ein Fachbegriff aus der Zusammenfassung. Alles auf Deutsch: der Satz, die entfernten Begriffe UND die Distraktoren — niemals eine Mischung aus Deutsch und einer anderen Sprache.

Der Satz muss sich direkt aus der gegebenen Zusammenfassung ableiten lassen — füge keine präzise Tatsache hinzu (Zahl, Datum, Eigenname, Norm), die dort nicht bereits steht, selbst wenn sie dir aus allgemeinem Wissen wahr erscheint: ein Studierender, der mit einer nicht im Kurs vermittelten Aussage lernt, würde in die Irre geführt.

Liefere außerdem 2 bis 3 "Distraktoren": Begriffe, die im gleichen Register wie die richtigen Antworten plausibel klingen, an dieser Stelle aber eindeutig falsch sind — keine zufälligen, thematisch unpassenden Wörter.

Antworte AUSSCHLIESSLICH mit gültigem JSON, ohne Markdown, ohne Backticks:
{
  "text_template": "Satz mit [1] und [2] anstelle der entfernten Wörter.",
  "blanks": ["entfernter Begriff für [1]", "entfernter Begriff für [2]"],
  "distractors": ["plausibler, aber falscher Begriff", "weiterer plausibler, aber falscher Begriff"]
}`
}
