import type { StudyChapter } from "./types"

export interface WebEnrichmentSource {
  title: string
  url: string
  summary_fr: string
}

export interface WebEnrichmentResult {
  sources: WebEnrichmentSource[]
}

/**
 * Prompt "Pour aller plus loin" — 2-3 sources fiables trouvées via
 * web_search en complément du contenu déjà extrait du PDF (voir
 * docs/db-anpassung.md §3bis). Contrainte de fiabilité explicite : sites
 * officiels/institutionnels plutôt que blogs, pour éviter le genre de
 * sources SEO peu fiables observées sur ce projet (voir recherche
 * "coûts API" de la session — un rapport avait cité des blogs non
 * vérifiables comme sources de chiffres).
 */
export function buildWebEnrichmentPrompt(
  chapter: Pick<StudyChapter, "title_de" | "concepts" | "summary">
): string {
  const conceptList = chapter.concepts.join(", ")

  return `Cherche 2 sources fiables sur le web en lien avec le chapitre "${chapter.title_de}", pour aller plus loin après avoir déjà étudié le résumé ci-dessous.

Résumé déjà connu : ${chapter.summary}
Concepts déjà couverts : ${conceptList}

Règles :
- Cherche en priorité des sources officielles ou institutionnelles : sites d'organismes (IEEE, ISO, W3C, universités, documentation officielle d'un langage/framework...), pas des blogs personnels ou du contenu SEO générique.
- Chaque source doit apporter un vrai complément (un exemple concret, un standard officiel, un contexte historique, une application réelle) — pas juste redire ce qui est déjà dans le résumé.
- Le résumé de chaque source doit être en français, 1-2 phrases, expliquant précisément ce qu'elle apporte en plus.
- N'invente jamais d'URL — n'utilise que des sources réellement trouvées par la recherche.

Réponds UNIQUEMENT avec du JSON valide, sans markdown, sans backticks :
{
  "sources": [
    { "title": "Titre de la page", "url": "https://...", "summary_fr": "Ce que cette source apporte en plus, en français." }
  ]
}`
}
