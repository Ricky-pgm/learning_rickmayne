"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Spinner } from "@/components/ui/spinner"
import { Globe, ChevronDown, ExternalLink, RefreshCw, Search } from "lucide-react"
import { getApiErrorMessage } from "@/lib/api-errors"
import { getCachedWebEnrichment, saveWebEnrichmentToCache } from "@/lib/study/web-enrichment-queries"
import type { WebEnrichmentResult } from "@/lib/study/web-enrichment-prompt"
import type { StudyChapter } from "@/lib/study/types"

interface Props {
  chapter: StudyChapter
}

/**
 * "Pour aller plus loin" — 2-3 sources externes fiables trouvées via
 * web_search, en complément du contenu déjà extrait du PDF. Contrairement
 * à DetailedLessonView : jamais généré automatiquement à l'ouverture, un
 * vrai bouton explicite déclenche la recherche — web_search facture par
 * recherche en plus des tokens (voir docs/etude-ai-architecture.md), donc
 * seul un choix actif de l'utilisateur doit la déclencher. Une fois
 * généré, mis en cache comme le cours détaillé (jamais repayé).
 */
export function WebEnrichmentView({ chapter }: Props) {
  const [open, setOpen] = useState(false)
  const [checkedCache, setCheckedCache] = useState(false)
  const [result, setResult] = useState<WebEnrichmentResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  // Vérifie le cache dès l'ouverture (lecture DB, gratuite) mais ne
  // déclenche jamais la recherche elle-même — seul le bouton le fait.
  useEffect(() => {
    if (!open || checkedCache) return
    getCachedWebEnrichment(chapter.id)
      .then(cached => {
        if (cached) setResult(cached)
      })
      .catch(e => setError(getApiErrorMessage(e instanceof Error ? e.message : "Erreur")))
      .finally(() => setCheckedCache(true))
  }, [open, checkedCache, chapter.id])

  const search = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/study/web-enrichment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chapterId: chapter.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Erreur")
      const fresh = data as WebEnrichmentResult & { model: string }
      setResult(fresh)
      await saveWebEnrichmentToCache(chapter.id, fresh, fresh.model)
    } catch (e) {
      setError(getApiErrorMessage(e instanceof Error ? e.message : "Erreur"))
    } finally {
      setLoading(false)
    }
  }, [chapter.id])

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-none">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 p-4 text-left transition-colors hover:bg-muted/30">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-accent-brand/10">
            <Globe className="h-5 w-5 text-accent-brand" />
          </div>
          <div className="min-w-0">
            <p className="text-lg font-semibold">Pour aller plus loin</p>
            <p className="text-sm text-muted-foreground">Sources externes fiables sur ce sujet</p>
          </div>
        </div>
        <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200 data-[state=open]:rotate-180" />
      </CollapsibleTrigger>

      <CollapsibleContent className="space-y-4 p-4 pt-0 sm:p-5 sm:pt-0">
        {!checkedCache && (
          <div className="flex justify-center py-4">
            <Spinner className="size-5 text-muted-foreground" />
          </div>
        )}

        {checkedCache && !result && !loading && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <p className="text-sm text-muted-foreground max-w-sm">
              Cherche des sources officielles (documentation, normes, sites institutionnels) pour compléter ce chapitre.
            </p>
            <Button onClick={search} size="sm" className="gap-2">
              <Search className="h-4 w-4" /> Chercher des sources
            </Button>
          </div>
        )}

        {loading && (
          <div className="flex flex-col items-center py-8 gap-3">
            <Spinner className="size-6 text-primary" />
            <p className="text-sm text-muted-foreground">Recherche en cours…</p>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={search}>
              Réessayer
            </Button>
          </div>
        )}

        {result && (
          <div className="space-y-3">
            {result.sources.map((source, i) => (
              <a
                key={i}
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-lg border border-border/70 p-3.5 transition-colors hover:border-accent-brand/40 hover:bg-muted/30"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium text-sm">{source.title}</p>
                  <ExternalLink className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground mt-0.5" />
                </div>
                <p className="text-xs text-muted-foreground mt-1">{source.summary_fr}</p>
                <p className="text-xs text-accent-brand/70 mt-1.5 truncate">{source.url}</p>
              </a>
            ))}
            <Button variant="outline" size="sm" className="gap-2" onClick={search}>
              <RefreshCw className="h-4 w-4" /> Chercher d&apos;autres sources
            </Button>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}
