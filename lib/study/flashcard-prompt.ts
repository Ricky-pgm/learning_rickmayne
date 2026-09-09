import type { StudyChapter } from "./types"

export interface GeneratedFlashcard {
  front_de: string
  back_de: string
  back_fr: string
}

/**
 * Prompt de génération de flashcards (étape 4, Haiku — génération fréquente
 * et format court, pas besoin de Sonnet, voir docs/etude-mode-plan.md §4.1).
 * Une carte par concept du chapitre, mise en cache après génération
 * (jamais régénérée automatiquement).
 *
 * Révisé : le prompt initial ne donnait au modèle que le résumé du
 * chapitre (déjà 2-4 phrases très condensées) avec pour instruction
 * "reste concis" — dans ces conditions, le modèle n'avait structurellement
 * rien d'autre à faire que reformuler légèrement ce résumé, ce qui
 * donnait des cartes perçues comme une simple recopie du cours plutôt
 * qu'un vrai outil de révision. Le prompt exige maintenant explicitement
 * une reformulation active (le recto pose une vraie question, jamais le
 * concept nu) et un ancrage concret (exemple ou piège fréquent au verso),
 * pas juste une définition compressée.
 */
export function buildFlashcardPrompt(chapter: Pick<StudyChapter, "title_de" | "concepts" | "summary">): string {
  const conceptList = chapter.concepts.join(", ")

  return `Génère une Lernkartei (jeu de flashcards) pour réviser le chapitre "${chapter.title_de}".

Résumé du chapitre : ${chapter.summary}
Concepts à couvrir : ${conceptList}

Crée UNE carte par concept listé (ni plus, ni moins). Le résumé ci-dessus est ton point de départ, pas le contenu final à recopier : à partir de ta connaissance générale du domaine, enrichis chaque carte avec ce que le résumé ne dit pas explicitement.

Chaque carte :
- "front_de" : une VRAIE question en allemand qui teste la compréhension du concept — jamais juste le nom du concept ni "Was ist [concept]?" (question trop générique). Pose plutôt une question sur la fonction, la différence avec un concept voisin, ou un cas d'usage concret. Un ton direct et vivant plutôt qu'académique — comme si un pote demandait "attends, mais concrètement ça sert à quoi ?" plutôt qu'une question d'examen.
- "back_de" : la réponse en allemand (2-4 phrases) qui va au-delà de la définition du résumé — inclus SOIT un exemple concret et parlant (une situation qu'on visualise), SOIT un piège fréquent/une confusion courante liée à ce concept ("attention, on confond souvent X avec Y"), SOIT une comparaison qui accroche avec un concept proche du même chapitre. Une réponse qui se limite à paraphraser le résumé n'est pas acceptable. Écris pour donner envie de retenir, pas pour réciter une définition de manuel : phrases courtes, direct, pas de jargon inutile.
- "back_fr" : la même réponse en français, avec le même ton vivant (pas une traduction mot à mot qui perdrait le naturel)

Règle impérative sur les faits — n'invente RIEN qui ressemble à un fait précis et vérifiable et qui n'est pas dans le résumé fourni : ni un détail supplémentaire sur un cas réel déjà cité (une entreprise, un incident...), ni une statistique/pourcentage/chiffre ("X% des entreprises...", "une étude montre..."), ni le nom d'une étude, d'une norme ou d'un organisme. Même si ce genre de détail te semble plausible ou vrai de ta connaissance générale, tu ne peux pas garantir qu'il correspond à ce que le cours source a réellement enseigné — présenté comme un fait établi sur une carte de révision, il induirait l'étudiant en erreur s'il le mémorise et le ressort en examen. Pour l'exemple concret ou la comparaison demandés au verso, utilise une situation générique et clairement hypothétique plutôt qu'un chiffre ou un cas réel nommé : "imagine que…", "prends le cas d'une entreprise qui…" — ce type d'exemple inventé est autorisé et même souhaité puisqu'il est présenté comme une illustration, pas comme une donnée factuelle.

Une carte reste courte à lire (quelques secondes), mais son contenu doit apprendre quelque chose de plus que le résumé, pas juste le redire en plus court — et surtout, elle doit donner envie de retourner la carte suivante plutôt que de sembler être un devoir.

Réponds UNIQUEMENT avec du JSON valide, sans markdown, sans backticks :
{
  "cards": [
    { "front_de": "...", "back_de": "...", "back_fr": "..." }
  ]
}`
}
