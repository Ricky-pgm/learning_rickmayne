"use client"

import { useCallback, useEffect, useState } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertAction } from "@/components/ui/alert"
import { Spinner } from "@/components/ui/spinner"
import { ArrowLeft, ArrowRight, FileText, Sparkles, AlertCircle, CheckCircle2, BookOpen, Clock } from "lucide-react"
import { cn } from "@/lib/utils"
import { getApiErrorMessage } from "@/lib/api-errors"
import { getStudyCourse, listFiles, updateStudyCourseFileStatus, saveIngestResult, countStudyChapters, advanceNextSliceIndex } from "@/lib/study/queries"
import { listStudyChaptersWithProgress, type StudyChapterWithProgress } from "@/lib/study/lesson-queries"
import { PROFILE_UI } from "@/lib/study/profile-ui"
import { estimateChapterTime } from "@/lib/study/time-estimate"
import type { IngestResult } from "@/lib/study/ingest-prompt"
import type { IngestPlan } from "@/app/api/study/ingest/plan/route"
import type { StudyCourse, StudyCourseFile } from "@/lib/study/types"

// Une ingestion normale (même multi-tranches sur un gros PDF) se termine en
// quelques minutes. Au-delà, un fichier resté en "processing" est presque
// certainement bloqué (onglet fermé/navigation pendant l'appel) plutôt
// qu'une génération réellement en cours — voir docs/db-anpassung.md §3 pour
// processed_at, écrit à chaque changement de statut par
// updateStudyCourseFileStatus.
const PROCESSING_STUCK_AFTER_MS = 10 * 60 * 1000

function isStuckProcessing(file: StudyCourseFile): boolean {
  if (file.status !== "processing") return false
  const since = file.processed_at ?? file.uploaded_at
  return Date.now() - new Date(since).getTime() > PROCESSING_STUCK_AFTER_MS
}

export default function EtudeCoursePage() {
  const params = useParams<{ courseId: string }>()
  const courseId = params.courseId

  const [course, setCourse] = useState<StudyCourse | null>(null)
  const [files, setFiles] = useState<StudyCourseFile[]>([])
  const [chapters, setChapters] = useState<StudyChapterWithProgress[]>([])
  const [loading, setLoading] = useState(true)
  const [processingFileId, setProcessingFileId] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    try {
      const [c, f, ch] = await Promise.all([
        getStudyCourse(courseId),
        listFiles(courseId),
        listStudyChaptersWithProgress(courseId),
      ])
      setCourse(c)
      setFiles(f)
      setChapters(ch)
    } catch (e) {
      setError(getApiErrorMessage(e instanceof Error ? e.message : String(e)))
    } finally {
      setLoading(false)
    }
  }, [courseId])

  useEffect(() => {
    Promise.resolve().then(() => load())
  }, [load])

  async function handleGenerate(file: StudyCourseFile) {
    setError("")
    setProcessingFileId(file.id)
    try {
      await updateStudyCourseFileStatus(file.id, "processing")

      // Un PDF de quelques dizaines de pages part en un seul appel — un
      // support de semestre complet (200+ pages) dépasse ce qu'une seule
      // réponse Sonnet peut produire (JSON tronqué avant la fin). /plan
      // détecte ce cas et découpe en tranches qui respectent les
      // frontières de chapitres (jamais un chapitre coupé en deux) ;
      // chaque tranche est ensuite ingérée séparément ci-dessous, en PDF
      // natif comme avant — voir lib/study/pdf-split.ts.
      const planRes = await fetch("/api/study/ingest/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId: file.id }),
      })
      const planData = await planRes.json()
      if (!planRes.ok) {
        throw new Error(planData.error ?? "Erreur lors de la planification de l'ingestion")
      }
      const plan = planData as IngestPlan

      // "Réessayer" reprend à la tranche qui a échoué, pas à la première —
      // sans ça, chaque nouvelle tentative retraitait (et repayait) les
      // tranches déjà réussies. next_slice_index avance après chaque
      // tranche traitée avec succès (voir advanceNextSliceIndex),
      // remis à 0 par défaut pour tout nouveau fichier.
      const startIndex = Math.min(file.next_slice_index, plan.slices.length)

      for (let i = startIndex; i < plan.slices.length; i++) {
        const slice = plan.slices[i]
        setProgress({ current: i + 1, total: plan.slices.length })

        const res = await fetch("/api/study/ingest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            plan.slices.length > 1
              ? { fileId: file.id, startPage: slice.startPage, endPage: slice.endPage }
              : { fileId: file.id }
          ),
        })
        const data = await res.json()
        if (!res.ok) {
          throw new Error(data.error ?? "Erreur lors de la génération des chapitres")
        }

        const ingestResult = data as IngestResult
        const existingCount = await countStudyChapters(courseId)
        await saveIngestResult(courseId, file.id, ingestResult, existingCount)
        await advanceNextSliceIndex(file.id, i)

        // Chaque tranche traitée est déjà sauvegardée en base — si une
        // tranche suivante échoue, les chapitres déjà générés restent
        // acquis plutôt que d'être perdus.
        await load()
      }

      await updateStudyCourseFileStatus(file.id, "done")
      await load()
    } catch (e) {
      const message = getApiErrorMessage(e instanceof Error ? e.message : String(e))
      setError(message)
      await updateStudyCourseFileStatus(file.id, "error", message).catch(() => {})
      await load()
    } finally {
      setProcessingFileId(null)
      setProgress(null)
    }
  }

  async function handleReset(file: StudyCourseFile) {
    setError("")
    try {
      await updateStudyCourseFileStatus(
        file.id,
        "error",
        "Génération interrompue (onglet fermé ou navigation pendant le traitement) — réessaie."
      )
      await load()
    } catch (e) {
      setError(getApiErrorMessage(e instanceof Error ? e.message : String(e)))
    }
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="space-y-4">
          <div className="h-6 w-40 rounded bg-muted/60 animate-pulse" />
          <div className="h-24 rounded-lg bg-muted/40 animate-pulse" />
        </div>
      </main>
    )
  }

  if (!course) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <p className="text-sm text-muted-foreground">Cours introuvable.</p>
        <Link href="/etude/dashboard" className="mt-3 inline-flex items-center gap-1.5 text-sm text-ring hover:underline">
          <ArrowLeft className="h-3.5 w-3.5" /> Retour à mes cours
        </Link>
      </main>
    )
  }

  const pendingFiles = files.filter(f => f.status === "pending" || f.status === "error" || isStuckProcessing(f))
  const masteredCount = chapters.filter(c => c.mastery_pct === 100).length
  const dueCount = chapters.filter(c => c.next_review !== null && new Date(c.next_review) <= new Date()).length

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8 space-y-6">
      <Link href="/etude/dashboard" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-3.5 w-3.5" /> Gérer mes cours
      </Link>

      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-ring/10 text-ring">
          {(() => {
            const Icon = PROFILE_UI[course.profile].icon
            return <Icon className="h-5 w-5" />
          })()}
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{course.title}</h1>
          <p className="text-sm text-muted-foreground">
            {chapters.length} chapitre{chapters.length !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {error && (
        <Alert variant="destructive" className="items-center gap-3">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
          <AlertAction onClick={() => setError("")}>OK</AlertAction>
        </Alert>
      )}

      {/* Fichiers pas encore traités — déclenchement manuel de la génération */}
      {pendingFiles.length > 0 && (
        <section className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Fichiers à traiter
          </p>
          {pendingFiles.map(f => {
            const stuck = isStuckProcessing(f) && processingFileId !== f.id
            return (
              <Card key={f.id} className="border border-border/70 bg-card shadow-none">
                <CardContent className="flex items-center gap-3 p-4">
                  <FileText className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{f.file_name}</p>
                    {f.status === "error" && f.error_message && (
                      <p className="truncate text-xs text-destructive">{f.error_message}</p>
                    )}
                    {stuck && (
                      <p className="truncate text-xs text-warning">
                        Génération interrompue — la page a dû être fermée pendant le traitement.
                      </p>
                    )}
                  </div>
                  {stuck ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-2 flex-shrink-0"
                      onClick={() => handleReset(f)}
                    >
                      Réinitialiser
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      className="gap-2 flex-shrink-0"
                      disabled={processingFileId === f.id}
                      onClick={() => handleGenerate(f)}
                    >
                      {processingFileId === f.id ? (
                        <>
                          <Spinner className="h-3.5 w-3.5" />
                          {progress && progress.total > 1
                            ? `Tranche ${progress.current}/${progress.total}...`
                            : "Génération..."}
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-3.5 w-3.5" /> {f.status === "error" ? "Réessayer" : "Générer les chapitres"}
                        </>
                      )}
                    </Button>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </section>
      )}

      {/* Chapitres générés */}
      {chapters.length > 0 ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              Chapitres
            </p>
            <p className="text-xs text-muted-foreground tabular-nums">
              {masteredCount}/{chapters.length} maîtrisés
              {dueCount > 0 && <span className="text-warning"> · {dueCount} à réviser</span>}
            </p>
          </div>
          <div className="space-y-2">
            {chapters
              .slice()
              .sort((a, b) => a.order - b.order)
              .map(ch => {
                const isDue = ch.next_review !== null && new Date(ch.next_review) <= new Date()
                const isMastered = ch.mastery_pct === 100
                const timeEstimate = estimateChapterTime(ch.concepts.length, ch.profile, ch.has_code)
                return (
                  <Link key={ch.id} href={`/etude/${courseId}/kapitel/${ch.id}`}>
                    <Card className="overflow-hidden border border-border/70 bg-card p-0 shadow-none transition-all hover:border-ring/40 hover:shadow-sm cursor-pointer">
                      <CardContent className="flex items-stretch gap-0 p-0">
                        {/* Bande d'état : lisible d'un coup d'œil sur une
                            liste longue (58 chapitres sur un cours réel),
                            là où un pourcentage seul se noie. */}
                        <div
                          className={cn(
                            "w-1 flex-shrink-0",
                            isDue ? "bg-warning" : isMastered ? "bg-success" : ch.mastery_pct > 0 ? "bg-ring" : "bg-border",
                          )}
                        />
                        <div className="flex min-w-0 flex-1 items-center gap-3 px-3.5 py-3 sm:px-4">
                          <Badge variant="secondary" className="flex-shrink-0 text-xs tabular-nums">
                            {ch.order}
                          </Badge>
                          <div className="min-w-0 flex-1 space-y-1.5">
                            <p className="truncate text-sm font-medium">{ch.title}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {ch.concepts.slice(0, 3).join(" · ")}
                            </p>
                            {ch.mastery_pct > 0 && (
                              <div className="h-1 w-full max-w-40 overflow-hidden rounded-full bg-muted">
                                <div
                                  className={cn("h-full rounded-full", isMastered ? "bg-success" : "bg-ring")}
                                  style={{ width: `${ch.mastery_pct}%` }}
                                />
                              </div>
                            )}
                          </div>
                          {isDue && (
                            <Badge variant="outline" className="flex-shrink-0 border-warning/40 text-xs text-warning">
                              À réviser
                            </Badge>
                          )}
                          {!isMastered && (
                            <span className="hidden flex-shrink-0 items-center gap-1 text-xs text-muted-foreground sm:inline-flex">
                              <Clock className="h-3 w-3" /> ~{timeEstimate.totalMinutes} min
                            </span>
                          )}
                          <ArrowRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                )
              })}
          </div>
        </section>
      ) : pendingFiles.length === 0 ? (
        <Card className="border-dashed border-2 border-muted-foreground/20 bg-muted/10">
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-ring/10">
              <BookOpen className="h-5 w-5 text-ring" />
            </div>
            <p className="text-sm text-muted-foreground max-w-sm">
              Aucun fichier importé pour ce cours. Ajoute un PDF depuis la page{" "}
              <Link href="/etude/dashboard" className="text-ring hover:underline">
                Gérer mes cours
              </Link>{" "}
              pour générer les premiers chapitres.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {chapters.length > 0 && pendingFiles.length === 0 && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CheckCircle2 className="h-3.5 w-3.5 text-success" /> Tous les fichiers de ce cours sont traités.
        </p>
      )}
    </main>
  )
}
