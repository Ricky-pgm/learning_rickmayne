import { buildDetailedLessonPrompt, type DetailedLesson } from '@/lib/study/lesson-prompt'
import { createGenerationRoute } from '@/lib/study/create-generation-route'

const model = 'claude-sonnet-5'

export const POST = createGenerationRoute({
  logLabel: 'study/lesson',
  quotaCategory: 'heavy',
  model,
  maxTokens: 6000,
  // Génération structurée (sections/exemples/pièges), pas un problème de
  // raisonnement — voir ai-client.ts et ingest/route.ts pour la mesure.
  effort: 'medium',
  buildPrompt: buildDetailedLessonPrompt,
  // model voyage avec la leçon jusqu'au client, qui le repasse à
  // saveLessonToCache — study_lessons_cache.model est not null (voir
  // docs/db-anpassung.md §3) et rien d'autre ici ne connaît le modèle
  // réellement utilisé pour cette génération.
  transformResult: parsed => ({ ...(parsed as DetailedLesson), model }),
})
