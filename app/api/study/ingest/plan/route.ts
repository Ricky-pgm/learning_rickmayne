import { getApiErrorMessage } from '@/lib/api-errors'
import { parseJsonBody } from '@/lib/api-request'
import { getSupabaseServerClient } from '@/lib/supabase-server'
import { callClaude, extractJSON } from '@/lib/study/ai-client'
import { checkAndConsumeAiQuota, RateLimitError } from '@/lib/study/rate-limit'
import { buildChapterBoundariesPrompt } from '@/lib/study/chapter-boundaries-prompt'
import {
  countPdfPages,
  extractPageTexts,
  groupChapterStartsIntoSlices,
  SPLIT_THRESHOLD_PAGES,
} from '@/lib/study/pdf-split'

const BUCKET = 'study-course-files'

export interface IngestPlan {
  totalPages: number
  slices: { startPage: number; endPage: number }[]
}

/**
 * Planifie l'ingestion d'un fichier : un seul document PDF passe rarement
 * en un seul appel Sonnet une fois au-delà de quelques dizaines de pages
 * (réponse tronquée avant la fin du JSON) — voir docs/etude-mode-plan.md
 * §5.3 étape 1. Sous le seuil, renvoie une tranche unique couvrant tout le
 * fichier (comportement inchangé). Au-delà, repère d'abord les frontières
 * de chapitres (texte brut + Haiku, quasi gratuit) puis découpe le PDF
 * physiquement sur ces frontières — jamais un chapitre à cheval sur deux
 * tranches. Chaque tranche est ensuite ingérée séparément par le client
 * via /api/study/ingest (PDF natif, comme avant).
 */
export async function POST(req: Request) {
  const body = await parseJsonBody<{ fileId?: string }>(req)
  const fileId = body?.fileId
  if (!fileId || typeof fileId !== 'string') {
    return Response.json({ error: 'fileId manquant' }, { status: 400 })
  }

  const supabase = await getSupabaseServerClient()

  const { data: fileRow, error: fileError } = await supabase
    .from('study_course_files')
    .select('storage_path, filename')
    .eq('id', fileId)
    .maybeSingle()

  if (fileError || !fileRow) {
    return Response.json({ error: 'Fichier introuvable ou accès refusé' }, { status: 404 })
  }

  const { data: blob, error: downloadError } = await supabase.storage
    .from(BUCKET)
    .download(fileRow.storage_path)

  if (downloadError || !blob) {
    return Response.json(
      { error: `Échec du téléchargement: ${downloadError?.message ?? 'fichier introuvable'}` },
      { status: 500 }
    )
  }

  const pdfBytes = new Uint8Array(await blob.arrayBuffer())
  const totalPages = await countPdfPages(pdfBytes)

  if (totalPages <= SPLIT_THRESHOLD_PAGES) {
    const plan: IngestPlan = { totalPages, slices: [{ startPage: 1, endPage: totalPages }] }
    return Response.json(plan)
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: getApiErrorMessage('ANTHROPIC_API_KEY') },
      { status: 500 }
    )
  }

  try {
    await checkAndConsumeAiQuota(supabase, 'light')
  } catch (e) {
    if (e instanceof RateLimitError) return Response.json({ error: e.message }, { status: 429 })
    throw e
  }

  try {
    const pageTexts = await extractPageTexts(pdfBytes)
    const prompt = buildChapterBoundariesPrompt(pageTexts)
    const text = await callClaude({ model: 'claude-haiku-4-5', prompt, maxTokens: 4000 })
    const { chapter_start_pages: chapterStartPages, subchapter_start_pages: subchapterStartPages } =
      extractJSON(text) as { chapter_start_pages: number[]; subchapter_start_pages?: number[] }

    // Un chapitre isolé dépasse fréquemment le seuil à lui seul sur un
    // support de semestre complet (cas observé : 128 pages) — les
    // frontières de sous-chapitres donnent des points de coupure plus fins
    // pour rester sous le seuil sans jamais couper une unité en deux.
    const allBoundaries = [...chapterStartPages, ...(subchapterStartPages ?? [])]
    const slices = groupChapterStartsIntoSlices(allBoundaries, totalPages, SPLIT_THRESHOLD_PAGES)
    const plan: IngestPlan = { totalPages, slices }
    return Response.json(plan)
  } catch (e) {
    console.error('[study/ingest/plan] repérage des frontières échoué', e)
    return Response.json(
      { error: `Impossible de planifier le découpage : ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 }
    )
  }
}
