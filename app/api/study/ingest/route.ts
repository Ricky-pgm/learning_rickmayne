import { buildIngestPrompt, type IngestResult } from '@/lib/study/ingest-prompt'
import { validateChapters } from '@/lib/study/validate-chapters'
import { getApiErrorMessage } from '@/lib/api-errors'
import { getSupabaseServerClient } from '@/lib/supabase-server'
import { extractPdfPageRange, countPdfPages } from '@/lib/study/pdf-split'
import { checkAndConsumeAiQuota, RateLimitError } from '@/lib/study/rate-limit'
import { extractTextBlock } from '@/lib/anthropic-response'
import { extractJSON } from '@/lib/study/ai-client'

// Limite dure de l'API Anthropic pour les PDF en pièce jointe (contexte 1M) —
// voir docs/etude-mode-plan.md §5.3 étape 1. Un fichier plus gros doit être
// découpé en tranches par l'appelant (voir /api/study/ingest/plan) avant
// d'arriver ici.
const MAX_PDF_BASE64_BYTES = 32 * 1024 * 1024

const BUCKET = 'study-course-files'

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: getApiErrorMessage('ANTHROPIC_API_KEY') },
      { status: 500 }
    )
  }

  const { fileId, startPage, endPage } = await req.json()
  if (!fileId || typeof fileId !== 'string') {
    return Response.json({ error: 'fileId manquant' }, { status: 400 })
  }

  const supabase = await getSupabaseServerClient()

  try {
    await checkAndConsumeAiQuota(supabase, 'heavy')
  } catch (e) {
    if (e instanceof RateLimitError) return Response.json({ error: e.message }, { status: 429 })
    throw e
  }

  // Le fichier n'a jamais transité par le navigateur ici — la route lit le
  // PDF directement depuis Storage côté serveur, plutôt que de le recevoir
  // en base64 du client (ça dépassait la limite de payload des fonctions
  // Vercel, ~4,5 Mo, pour n'importe quel PDF de cours réaliste). RLS
  // s'applique normalement : ce select ne renvoie la ligne que si fileId
  // appartient à l'utilisateur de la session courante.
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

  let buffer = Buffer.from(await blob.arrayBuffer())

  // Un fichier trop volumineux pour un seul appel a été planifié en
  // tranches par /api/study/ingest/plan — celle-ci ne traite que la plage
  // de pages demandée, jamais le PDF entier.
  if (typeof startPage === 'number' && typeof endPage === 'number') {
    const totalPages = await countPdfPages(new Uint8Array(buffer))
    if (!Number.isInteger(startPage) || !Number.isInteger(endPage) ||
        startPage < 1 || endPage < startPage || endPage > totalPages) {
      return Response.json(
        { error: `Plage de pages invalide (${startPage}-${endPage}) pour un document de ${totalPages} pages.` },
        { status: 400 }
      )
    }
    try {
      const sliceBytes = await extractPdfPageRange(new Uint8Array(buffer), startPage, endPage)
      buffer = Buffer.from(sliceBytes)
    } catch (e) {
      console.error('[study/ingest] découpage de la plage de pages échoué', e)
      return Response.json({ error: 'Impossible de découper le PDF sur cette plage de pages.' }, { status: 500 })
    }
  }

  const pdfBase64 = buffer.toString('base64')

  if (pdfBase64.length > MAX_PDF_BASE64_BYTES) {
    return Response.json(
      { error: `Le fichier "${fileRow.filename}" dépasse la limite de 32 Mo. Découpe-le en plusieurs fichiers plus petits avant de l'uploader.` },
      { status: 413 }
    )
  }

  const prompt = buildIngestPrompt()

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 16000,
      // L'extraction de chapitres est une tâche d'extraction structurée, pas
      // un problème de raisonnement — le thinking par défaut de Sonnet 5
      // ajoutait ~5500 tokens de raisonnement facturés (~60% du coût de
      // sortie) sans changer le résultat. Vérifié sur un vrai document :
      // effort "medium" élimine le thinking (thinking_tokens: 0) et
      // détecte même un chapitre de plus (7 vs 6 à "low").
      output_config: { effort: 'medium' },
      messages: [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
            // Le PDF de la tranche domine l'input (58k+ tokens observés,
            // largement au-dessus du minimum cacheable ~1024) — si cette
            // même tranche est renvoyée dans les 5 minutes (retry après un
            // JSON invalide, par ex., cf. la validation plus bas), Claude
            // réutilise le PDF déjà vu à ~10% du prix de l'input au lieu
            // de le repayer plein tarif à chaque tentative.
            cache_control: { type: 'ephemeral' }
          },
          { type: 'text', text: prompt }
        ]
      }]
    })
  })

  const data = await res.json()
  if (!res.ok) {
    console.error('[study/ingest] Anthropic error', res.status, data)
    return Response.json(
      { error: data.error?.message ?? 'Erreur Anthropic' },
      { status: res.status }
    )
  }

  // cache_read_input_tokens à 0 de façon répétée sur la même tranche
  // signalerait un invalidateur silencieux (contenu du prompt qui varie,
  // TTL de 5 min dépassé) — sans ce log, impossible de vérifier que le
  // cache_control posé plus haut sert vraiment à quelque chose.
  console.log('[study/ingest] usage', {
    filename: fileRow.filename,
    startPage,
    endPage,
    input_tokens: data.usage?.input_tokens,
    cache_creation_input_tokens: data.usage?.cache_creation_input_tokens,
    cache_read_input_tokens: data.usage?.cache_read_input_tokens,
    output_tokens: data.usage?.output_tokens,
  })

  if (data.stop_reason === 'max_tokens') {
    console.error('[study/ingest] réponse tronquée (max_tokens)', { filename: fileRow.filename, startPage, endPage })
    return Response.json(
      { error: `La réponse de l'IA a été tronquée avant la fin pour "${fileRow.filename}"${startPage ? ` (pages ${startPage}-${endPage})` : ''}. Le découpage en tranches n'a pas suffi — réessaie, ou signale ce cas.` },
      { status: 500 }
    )
  }

  // content[0] n'est pas forcément le bloc de texte — Claude peut répondre
  // avec un bloc "thinking" en tête suivi du bloc "text" (observé en
  // pratique sur un PDF volumineux) ; lire content[0].text donnait alors
  // une chaîne vide malgré une vraie réponse juste après.
  const text = extractTextBlock(data.content)
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1) {
    // stop_reason renseigne sur la vraie cause d'une réponse vide/inexploitable
    // (refus, filtre de contenu, pause d'outil...) — sans lui, ce cas était
    // indistinguable d'un simple aléa côté modèle.
    console.error('[study/ingest] pas de JSON exploitable dans la réponse', {
      stopReason: data.stop_reason,
      contentBlockCount: data.content?.length ?? 0,
      contentTypes: (data.content ?? []).map((b: { type?: string }) => b.type),
      textExcerpt: text.slice(0, 500),
      filename: fileRow.filename,
      startPage,
      endPage,
    })
    return Response.json(
      {
        error: `Réponse de l'IA inexploitable pour "${fileRow.filename}"${startPage ? ` (pages ${startPage}-${endPage})` : ''} — motif d'arrêt : ${data.stop_reason ?? 'inconnu'}. ${text.slice(0, 200) ? `Texte reçu : "${text.slice(0, 200)}"` : 'Aucun texte reçu.'}`,
      },
      { status: 500 }
    )
  }

  // extractJSON (au lieu d'un JSON.parse brut, comme avant) : un PDF de
  // cours contient souvent des sauts de ligne bruts dans un extrait de code
  // ou une citation que le modèle recopie sans les échapper — exactement le
  // motif que ce endpoint laissait remonter comme "JSON invalide" sans
  // repli, après avoir déjà payé le coût du plus gros appel Sonnet de
  // l'app. Même fonction de repli que les autres générations IA.
  let ingestResult: IngestResult
  try {
    ingestResult = extractJSON(text.slice(start, end + 1)) as IngestResult
  } catch (e) {
    console.error('[study/ingest] JSON invalide', e, text.slice(0, 500))
    return Response.json(
      { error: `JSON invalide reçu de l'IA : ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 }
    )
  }

  // Un JSON syntaxiquement valide peut quand même avoir la mauvaise forme
  // (chapters absent, champ obligatoire manquant sur un chapitre) — sans
  // ce contrôle, l'erreur suivante serait un TypeError générique au lieu
  // d'un message exploitable, avant même d'atteindre validateChapters.
  if (!Array.isArray(ingestResult.chapters) || ingestResult.chapters.length === 0) {
    console.error('[study/ingest] pas de chapitres exploitables dans la réponse', text.slice(0, 500))
    return Response.json(
      { error: `L'IA n'a renvoyé aucun chapitre exploitable pour "${fileRow.filename}"${startPage ? ` (pages ${startPage}-${endPage})` : ''}. Réessaie, ou signale ce cas.` },
      { status: 500 }
    )
  }
  const missingFieldIndex = ingestResult.chapters.findIndex(
    c => !c.title_de?.trim() || !c.title_fr?.trim() || !c.summary?.trim() || !Array.isArray(c.concepts)
  )
  if (missingFieldIndex !== -1) {
    console.error('[study/ingest] chapitre incomplet dans la réponse', ingestResult.chapters[missingFieldIndex])
    return Response.json(
      { error: `L'IA a renvoyé un chapitre incomplet (titre, résumé ou concepts manquant) pour "${fileRow.filename}". Réessaie la génération.` },
      { status: 500 }
    )
  }

  const issues = validateChapters(
    ingestResult.chapters.map(c => ({
      order: c.order,
      title_de: c.title_de,
      title_fr: c.title_fr,
      concepts: c.concepts,
      summary: c.summary,
      has_code: c.has_code,
    }))
  )

  return Response.json({ ...ingestResult, validationIssues: issues })
}
