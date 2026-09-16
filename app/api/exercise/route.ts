import { getChapter } from '@/lib/courses'
import { buildPrompt } from '@/lib/prompts'
import { getApiErrorMessage } from '@/lib/api-errors'
import { parseJsonBody } from '@/lib/api-request'
import { extractTextBlock } from '@/lib/anthropic-response'
import { extractJSON } from '@/lib/study/ai-client'
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

  const body = await parseJsonBody<{
    courseId?: string
    chapterId?: number
    exerciseType?: string
    fillBlankMode?: string
  }>(req)
  const { courseId, chapterId, exerciseType, fillBlankMode } = body ?? {}
  if (!exerciseType) {
    return Response.json({ error: 'exerciseType manquant' }, { status: 400 })
  }
  const chapter = courseId && chapterId !== undefined ? getChapter(courseId, chapterId) : null
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
  if (!text.includes('{') || !text.includes('}')) {
    return Response.json({ error: 'Réponse invalide' }, { status: 500 })
  }

  // extractJSON (au lieu d'un JSON.parse brut, comme avant) : même repli
  // que /api/study/* — voir lib/study/ai-client.ts.
  try {
    const exercise = extractJSON(text)
    return Response.json(exercise)
  } catch (e) {
    return Response.json({ error: `JSON invalide reçu de l'IA : ${e instanceof Error ? e.message : String(e)}` }, { status: 500 })
  }
}
