import { buildFillBlankPrompt } from '@/lib/study/fill-blank-prompt'
import { createGenerationRoute } from '@/lib/study/create-generation-route'

export const POST = createGenerationRoute({
  logLabel: 'study/fill-blank',
  quotaCategory: 'light',
  model: 'claude-haiku-4-5',
  maxTokens: 1500,
  buildPrompt: buildFillBlankPrompt,
})
