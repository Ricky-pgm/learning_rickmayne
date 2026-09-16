import { getChapter } from '@/lib/courses'
import { buildPrompt } from '@/lib/prompts'
import { getApiErrorMessage } from '@/lib/api-errors'
import { extractTextBlock } from '@/lib/anthropic-response'
import { getSupabaseServerClient } from '@/lib/supabase-server'
import { checkAndConsumeAiQuota, RateLimitError } from '@/lib/study/rate-limit'

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: getApiErrorMessage('ANTHROPIC_API_KEY') },
      { status: 500 }
    )
  }

  // Cette route (mode Klausur, legacy) n'avait aucune limite — même garde
  // que /api/study/* (audit sécurité).
  try {
    await checkAndConsumeAiQuota(await getSupabaseServerClient(), 'heavy')
  } catch (e) {
    if (e instanceof RateLimitError) return Response.json({ error: e.message }, { status: 429 })
    throw e
  }

  const { courseId, chapterId, exerciseType, fillBlankMode } = await req.json()
  const chapter = getChapter(courseId, chapterId)
  if (!chapter) return Response.json({ error: 'Chapitre non trouvé' }, { status: 404 })

  if (chapter.hasCode === false && exerciseType === 'codeAnalysis') {
    return Response.json(
      { error: "Ce type d'exercice n'est pas disponible pour ce chapitre." },
      { status: 400 }
    )
  }

  if (exerciseType === 'code' && (chapter.hasCode === false || chapter.lang !== 'python')) {
    return Response.json(
      { error: "Ce type d'exercice n'est pas disponible pour ce chapitre." },
      { status: 400 }
    )
  }

  const prompt = buildPrompt(chapter, exerciseType, fillBlankMode)

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: exerciseType === 'code' ? 3000 : 2000,
      messages: [{ role: 'user', content: prompt }]
    })
  })

  const data = await res.json()
  if (!res.ok) {
    return Response.json(
      { error: data.error?.message ?? 'Erreur Anthropic' },
      { status: res.status }
    )
  }

  const text = extractTextBlock(data.content)
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1) return Response.json({ error: 'Réponse invalide' }, { status: 500 })

  try {
    const exercise = JSON.parse(text.slice(start, end + 1))
    return Response.json(exercise)
  } catch {
    return Response.json({ error: 'JSON invalide' }, { status: 500 })
  }
}
