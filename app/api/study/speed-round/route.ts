import { buildSpeedRoundPrompt } from '@/lib/study/speed-round-prompt'
import { createGenerationRoute } from '@/lib/study/create-generation-route'

export const POST = createGenerationRoute({
  logLabel: 'study/speed-round',
  quotaCategory: 'light',
  model: 'claude-haiku-4-5',
  maxTokens: 3000,
  // Résolu via RLS — profile vient aussi du chapitre en DB plutôt que du
  // client (study_chapters.profile, synchronisé par trigger depuis
  // study_courses.profile), voir get-chapter-for-prompt.ts.
  buildPrompt: chapter => buildSpeedRoundPrompt(chapter, chapter.profile),
})
