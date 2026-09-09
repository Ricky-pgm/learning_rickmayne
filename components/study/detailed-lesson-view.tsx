"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Alert, AlertDescription, AlertAction } from "@/components/ui/alert"
import { Spinner } from "@/components/ui/spinner"
import { Badge } from "@/components/ui/badge"
import { CodeBlock } from "@/components/code-block"
import { AlertCircleIcon, BookOpen, CheckCircle2, ChevronDown, Lightbulb, RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"
import { getApiErrorMessage } from "@/lib/api-errors"
import { getCachedLesson, saveLessonToCache } from "@/lib/study/lesson-queries"
import type { DetailedLesson } from "@/lib/study/lesson-prompt"
import type { StudyChapter } from "@/lib/study/types"
import type { Lang } from "@/lib/chapters/types"

interface Props {
  chapter: StudyChapter
  lang: Lang
  /** Remonté à l'ouverture du panneau — sert à StudyPhase pour marquer
   * la phase "Comprendre" comme entamée sur la page chapitre, sans
   * dupliquer l'état d'ouverture ici et côté parent. */
  onOpenChange?: (open: boolean) => void
}

export function DetailedLessonView({ chapter, lang, onOpenChange }: Props) {
  const [open, setOpenState] = useState(false)
  const setOpen = useCallback((v: boolean) => {
    setOpenState(v)
    onOpenChange?.(v)
  }, [onOpenChange])
  const [lesson, setLesson] = useState<DetailedLesson | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [showFr, setShowFr] = useState(false)
  const [activeSection, setActiveSection] = useState(0)

  const generateLesson = useCallback(async (): Promise<DetailedLesson & { model: string }> => {
    const res = await fetch('/api/study/lesson', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chapterId: chapter.id })
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? 'Erreur')
    return data as DetailedLesson & { model: string }
  }, [chapter.id])

  const loadLesson = useCallback(async (forceRegenerate: boolean) => {
    setLoading(true)
    setError("")
    try {
      if (!forceRegenerate) {
        const cached = await getCachedLesson(chapter.id)
        if (cached) {
          setLesson(cached)
          setLoading(false)
          return
        }
      }
      const fresh = await generateLesson()
      setLesson(fresh)
      await saveLessonToCache(chapter.id, fresh, fresh.model)
    } catch (e) {
      setError(getApiErrorMessage(e instanceof Error ? e.message : 'Erreur'))
    } finally {
      setLoading(false)
    }
  }, [chapter.id, generateLesson])

  useEffect(() => {
    if (!open || lesson) return
    Promise.resolve().then(() => loadLesson(false))
  }, [open, lesson, loadLesson])

  const totalSections = lesson?.sections.length ?? 0

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-none">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 p-4 text-left transition-colors hover:bg-muted/30">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-ring/10">
            <BookOpen className="h-5 w-5 text-ring" />
          </div>
          <div className="min-w-0">
            <p className="text-lg font-semibold">Cours détaillé</p>
            <p className="text-sm text-muted-foreground">Tous les concepts, avec exemples et astuces</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {lesson && (
            <Badge variant="secondary" className="text-xs hidden sm:inline-flex">
              {totalSections} section{totalSections > 1 ? "s" : ""}
            </Badge>
          )}
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200 data-[state=open]:rotate-180" />
        </div>
      </CollapsibleTrigger>

      <CollapsibleContent className="space-y-5 p-4 pt-0 sm:p-5 sm:pt-0">
        {loading && (
          <div className="flex flex-col items-center py-8 gap-3">
            <Spinner className="size-6 text-primary" />
            <p className="text-sm text-muted-foreground">Claude prépare le cours détaillé…</p>
          </div>
        )}

        {error && (
          <Alert variant="destructive" className="items-center gap-3 p-3 sm:grid-cols-[auto_1fr_auto]">
            <AlertCircleIcon />
            <AlertDescription className="text-sm leading-6">{error}</AlertDescription>
            <AlertAction className="static mt-2 sm:mt-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => loadLesson(false)}
                className="w-full border-destructive/30 text-destructive hover:bg-destructive/10 sm:w-auto"
              >
                <RefreshCw className="h-4 w-4" />
                Réessayer
              </Button>
            </AlertAction>
          </Alert>
        )}

        {lesson && (
          <>
            {/* Language toggle & intro */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground italic">{lesson.intro_fr}</p>
              <Button variant="outline" size="sm" onClick={() => setShowFr(f => !f)} className="w-fit flex-shrink-0">
                {showFr ? '🇩🇪 Deutsch' : '🇫🇷 Français'}
              </Button>
            </div>

            {/* Section navigator */}
            {totalSections > 1 && (
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                {lesson.sections.map((section, i) => (
                  <button
                    key={i}
                    onClick={() => setActiveSection(i)}
                    className={cn(
                      "flex-shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors",
                      i === activeSection
                        ? "bg-ring text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/80",
                    )}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
            )}

            {/* Sections */}
            <div className="space-y-6">
              {lesson.sections.map((section, i) => (
                <div
                  key={i}
                  className={cn(
                    "space-y-3 border-b border-border/50 pb-5 last:border-0 last:pb-0",
                    totalSections > 1 && i !== activeSection && "hidden",
                  )}
                >
                  {/* Section header */}
                  <div className="flex items-start gap-3">
                    <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-ring/10 text-xs font-bold text-ring mt-0.5">
                      {i + 1}
                    </div>
                    <h3 className="scroll-m-20 text-xl font-semibold tracking-tight sm:text-2xl pt-0.5">
                      {section.heading_de}
                    </h3>
                  </div>

                  {/* Content */}
                  <div className="pl-10 space-y-3">
                    <p className="leading-7 text-foreground/90">{showFr ? section.explanation_fr : section.explanation_de}</p>

                    {section.example && lang !== 'none' && (
                      <CodeBlock code={section.example} lang={lang} />
                    )}
                    {section.example && lang === 'none' && (
                      <p className="rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-sm italic">{section.example}</p>
                    )}

                    {/* Memory tip */}
                    <div className="flex items-start gap-2.5 rounded-lg bg-warning/5 border border-warning/20 p-3">
                      <Lightbulb className="h-4 w-4 flex-shrink-0 text-warning mt-0.5" />
                      <p className="text-sm text-foreground/80">{section.memory_tip_fr}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Key points */}
            {lesson.key_points_de.length > 0 && (
              <div className="rounded-lg bg-success/5 border border-success/20 p-4 space-y-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-success">
                  <CheckCircle2 className="h-4 w-4" /> À retenir
                </div>
                <ul className="space-y-1.5">
                  {lesson.key_points_de.map((pt, i) => (
                    <li key={i} className="leading-7 flex items-start gap-2 text-sm">
                      <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-1 text-success" /> {pt}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <Button
              variant="outline"
              size="lg"
              onClick={() => loadLesson(true)}
              className="h-9 w-full rounded-lg border-border bg-background font-medium hover:bg-muted"
            >
              <RefreshCw className="h-4 w-4" />
              Régénérer le cours
            </Button>
          </>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}
