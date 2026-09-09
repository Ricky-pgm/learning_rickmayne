import type { Lang } from "@/lib/chapters/types"

export interface IngestResult {
  course_title: string
  profile: "programming" | "theory" | "mixed"
  detected_language: Lang | null
  chapters: {
    order: number
    title_de: string
    title_fr: string
    concepts: string[]
    summary: string
    has_code: boolean
    code_lang: Lang | null
    is_organizational: boolean
  }[]
}

/**
 * Prompt d'ingestion d'un support de cours (PDF envoyé nativement en pièce
 * jointe — voir docs/etude-mode-plan.md §4.3). Découpe en chapitres au
 * format proche de lib/chapters/types.ts et détecte le profil du cours
 * pour piloter lib/study/exercise-strategy.ts.
 *
 * Le modèle numérote toujours à partir de 1 pour le document qu'il voit ;
 * quand un PDF volumineux est traité en plusieurs tranches (§5.3 étape 1),
 * c'est l'appelant qui décale ensuite ces numéros locaux pour obtenir une
 * numérotation continue sur l'ensemble du cours.
 */
export function buildIngestPrompt(): string {
  return `Tu es un assistant pédagogique qui prépare un support de cours pour un système de révision quotidienne. Analyse le document PDF fourni (support de cours, slides ou notes) et découpe-le en chapitres exploitables.

Pour chaque chapitre, identifie :
- un titre concis en allemand ET en français
- la liste des concepts clés abordés (mots ou courtes expressions) — laisse vide si le chapitre est organisationnel (voir is_organizational ci-dessous)
- un résumé de 2-4 phrases qui mentionne explicitement chacun des concepts listés
- si le chapitre contient du code ou des exemples de syntaxe technique (has_code)
- si oui, dans quel langage (code_lang) parmi : "java", "python", "perl", "javascript" — null si has_code est false ou si le langage n'en fait pas partie
- is_organizational : true si ce "chapitre" est en réalité du contenu organisationnel plutôt que du contenu de cours à réviser — plan du semestre, calendrier des séances, modalités/dates d'examen, règles de présence, coordonnées de l'enseignant, barème de notation. Ce n'est PAS organisationnel : une introduction qui pose les enjeux du cours, un rappel de prérequis. Pour un chapitre organisationnel, le résumé doit rester court (1-2 phrases, l'essentiel seulement) et concepts doit être un tableau vide — ne fabrique pas de "concepts" artificiels juste pour remplir le champ.

Détecte aussi le profil global du cours :
- "programming" : cours de programmation (un langage précis domine)
- "theory" : cours sans code, conceptuel (gestion de projet, méthodologie, théorie)
- "mixed" : mélange des deux selon les chapitres

Si le cours est de type "programming" ou "mixed" avec du code, précise le langage de programmation dominant (detected_language) parmi : "java", "python", "perl", "javascript". Si aucun langage de programmation n'est concerné, mets detected_language à null.

Règles impératives :
- Un chapitre = une unité thématique cohérente, ni trop fine (un seul concept) ni trop large (plusieurs thèmes non liés).
- Numérote les chapitres à partir de 1, dans l'ordre d'apparition dans le document (même si ce document est une partie d'un support plus large — numérote uniquement ce que tu vois, en commençant à 1).
- N'invente aucun contenu absent du document. Si une partie du document n'est pas un contenu de cours exploitable (page de garde, sommaire, bibliographie), ignore-la.
- Le contenu organisationnel (voir is_organizational) n'est PAS ignoré comme une page de garde : il devient son propre chapitre, marqué is_organizational: true, avec un résumé court — jamais fusionné avec un chapitre de contenu, jamais transformé en exercices.
- Chaque résumé doit mentionner par leur nom tous les concepts listés pour ce chapitre (sauf chapitre organisationnel, où concepts est vide).

Réponds UNIQUEMENT avec du JSON valide, sans markdown, sans backticks :
{
  "course_title": "Titre général déduit du document",
  "profile": "programming" | "theory" | "mixed",
  "detected_language": "java" | "python" | "perl" | "javascript" | null,
  "chapters": [
    {
      "order": 1,
      "title_de": "Titre en allemand",
      "title_fr": "Titre en français",
      "concepts": ["concept1", "concept2"],
      "summary": "Résumé mentionnant concept1 et concept2 explicitement.",
      "has_code": true,
      "code_lang": "java",
      "is_organizational": false
    }
  ]
}`
}
