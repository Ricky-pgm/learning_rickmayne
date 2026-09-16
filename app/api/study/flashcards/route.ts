import { buildFlashcardPrompt } from '@/lib/study/flashcard-prompt'
import { createGenerationRoute } from '@/lib/study/create-generation-route'

export const POST = createGenerationRoute({
  logLabel: 'study/flashcards',
  quotaCategory: 'light',
  model: 'claude-haiku-4-5',
  maxTokens: 3000,
  buildPrompt: buildFlashcardPrompt,
})
