import { buildBugHuntPrompt } from '@/lib/study/bug-hunt-prompt'
import { createGenerationRoute } from '@/lib/study/create-generation-route'

export const POST = createGenerationRoute({
  logLabel: 'study/bug-hunt',
  quotaCategory: 'light',
  model: 'claude-haiku-4-5',
  maxTokens: 2000,
  requiresCode: true,
  buildPrompt: buildBugHuntPrompt,
})
