import { buildCodeCompletePrompt } from '@/lib/study/code-complete-prompt'
import { createGenerationRoute } from '@/lib/study/create-generation-route'

export const POST = createGenerationRoute({
  logLabel: 'study/code-complete',
  quotaCategory: 'light',
  model: 'claude-haiku-4-5',
  maxTokens: 2000,
  requiresCode: true,
  buildPrompt: buildCodeCompletePrompt,
})
