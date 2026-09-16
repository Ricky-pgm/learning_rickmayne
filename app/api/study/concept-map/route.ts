import { buildConceptMapPrompt } from '@/lib/study/concept-map-prompt'
import { createGenerationRoute } from '@/lib/study/create-generation-route'

export const POST = createGenerationRoute({
  logLabel: 'study/concept-map',
  quotaCategory: 'light',
  model: 'claude-haiku-4-5',
  maxTokens: 2000,
  buildPrompt: buildConceptMapPrompt,
})
