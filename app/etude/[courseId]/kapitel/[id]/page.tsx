"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import {
  ArrowLeft,
  Zap,
  Lightbulb,
  Code2,
  Bug,
  PenLine,
  Link2,
  Network,
  Info,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { getApiErrorMessage } from "@/lib/api-errors"
import { listStudyChapters, getStudyChapter, type StudyChapterWithCourseTitle } from "@/lib/study/lesson-queries"
import { DetailedLessonView } from "@/components/study/detailed-lesson-view"
import { FlashcardReview } from "@/components/study/flashcard-review"
import { SpeedRound } from "@/components/study/exercises/speed-round"
import { MemoryMatch } from "@/components/study/exercises/memory-match"
import { BugHunt } from "@/components/study/exercises/bug-hunt"
import { ConceptMap } from "@/components/study/exercises/concept-map"
import { FillBlank } from "@/components/study/exercises/fill-blank"
import { CodeComplete } from "@/components/study/exercises/code-complete"
import { WebEnrichmentView } from "@/components/study/web-enrichment-view"
import { StudyPhase } from "@/components/study/study-phase"
import { TimeRing } from "@/components/study/time-ring"
import { ChapterCompleteCelebration } from "@/components/study/chapter-complete-celebration"
import { getExerciseSlots } from "@/lib/study/exercise-strategy"
import { estimateChapterTime } from "@/lib/study/time-estimate"
import { getCachedFlashcards } from "@/lib/study/flashcard-queries"
import type { StudyChapter } from "@/lib/study/types"
import type { Lang } from "@/lib/chapters/types"

export default function StudyChapterPage({
  params,
}: {
  params: Promise<{ courseId: string; id: string }>
}) {
  const [chapter, setChapter] = useState<StudyChapterWithCourseTitle | null>(null)
  const [allChapters, setAllChapters] = useState<StudyChapter[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  // null tant qu'aucun exercice n'est choisi — sans ça, defaultValue sur
  // <Tabs> montait Speed Round dès l'affichage de la phase 3, avant même
  // que l'étudiant ait fini de lire le cours, déclenchant un appel Haiku
  // sans action de sa part.
  const [activeExercise, setActiveExercise] = useState<string | null>(null)
  // Un onglet une fois ouvert reste dans cet ensemble pour garder
  // keepMounted actif seulement sur lui — passer keepMounted en dur sur
  // TOUS les TabsContent les monterait tous dès le rendu (keepMounted
  // n'est pas conditionné par la sélection côté base-ui), ce qui
  // déclencherait un appel API par exercice au lieu d'un seul.
  const [visitedExercises, setVisitedExercises] = useState<Set<string>>(new Set())
  // Distinct de visitedExercises : celui-ci sert UNIQUEMENT à garder un
  // exercice monté pour ne pas perdre sa progression au changement
  // d'onglet — il se remplit dès qu'un onglet est ouvert, pas quand
  // l'exercice est réellement fini. completedExercises, lui, ne se
  // remplit que via le callback onComplete de chaque exercice (une fois
  // le défi réellement réussi) — c'est le seul des deux qui doit compter
  // pour la phase "S'entraîner" (voir phasesDone plus bas). Avant cette
  // distinction, ouvrir simplement l'onglet Speed Round suffisait à
  // marquer la phase comme faite sans avoir répondu à une question.
  const [completedExercises, setCompletedExercises] = useState<Set<string>>(new Set())

  function markExerciseCompleted(type: string) {
    setCompletedExercises(prev => prev.has(type) ? prev : new Set(prev).add(type))
  }
  // Signale l'avancement réel dans chaque phase — purement visuel (voir
  // StudyPhase), remis à zéro à chaque montage donc pas persisté : rouvrir
  // le chapitre plus tard montre à nouveau les trois phases "à faire",
  // cohérent avec le fait que le cours/les cartes ne se rouvrent pas non
  // plus automatiquement.
  const [lessonOpened, setLessonOpened] = useState(false)
  const [flashcardsDone, setFlashcardsDone] = useState(false)
  // Affine l'estimation de temps avec le vrai nombre de cartes une fois
  // connu (lecture de cache, gratuite) — undefined tant que non chargé,
  // estimateChapterTime retombe alors sur une estimation à partir du
  // nombre de concepts.
  const [realFlashcardCount, setRealFlashcardCount] = useState<number | undefined>(undefined)
  // Célébration déclenchée au passage de <3 à 3 phases faites — pas à
  // chaque re-render une fois à 3 (sinon rouverte à chaque changement
  // d'onglet d'exercice une fois le chapitre déjà fini).
  const [showCelebration, setShowCelebration] = useState(false)
  const [celebrationShown, setCelebrationShown] = useState(false)

  useEffect(() => {
    let cancelled = false
    params.then(({ courseId, id }) => {
      Promise.all([
        getStudyChapter(id),
        listStudyChapters(courseId),
      ]).then(([ch, all]) => {
        if (cancelled) return
        setChapter(ch)
        setAllChapters(all)
      }).catch(e => {
        if (!cancelled) setError(getApiErrorMessage(e instanceof Error ? e.message : String(e)))
      }).finally(() => {
        if (!cancelled) setLoading(false)
      })
    })
    return () => { cancelled = true }
  }, [params])

  useEffect(() => {
    if (!chapter) return
    let cancelled = false
    getCachedFlashcards(chapter.id)
      .then(cards => { if (!cancelled && cards.length > 0) setRealFlashcardCount(cards.length) })
      .catch(() => {
        // Best-effort — l'estimation retombe sur le nombre de concepts,
        // jamais bloquant pour l'affichage de la page.
      })
    return () => { cancelled = true }
  }, [chapter])

  // Déclenche la célébration exactement au passage à 3 phases faites —
  // recalculé ici plutôt qu'à partir de la variable phasesDone plus bas
  // (dérivée après les early-returns) pour rester un Hook inconditionnel.
  useEffect(() => {
    const done = (lessonOpened ? 1 : 0) + (flashcardsDone ? 1 : 0) + (completedExercises.size > 0 ? 1 : 0)
    if (done >= 3 && !celebrationShown) {
      setShowCelebration(true)
      setCelebrationShown(true)
    }
  }, [lessonOpened, flashcardsDone, completedExercises, celebrationShown])

  if (loading) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="space-y-4">
          <div className="h-6 w-32 rounded bg-muted/60 animate-pulse" />
          <div className="h-10 w-64 rounded bg-muted/40 animate-pulse" />
          <div className="h-6 w-48 rounded bg-muted/40 animate-pulse" />
        </div>
      </main>
    )
  }

  if (error || !chapter) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error || "Chapitre introuvable."}
        </p>
        <Link href="/etude" className="mt-4 inline-block text-sm text-muted-foreground hover:text-foreground">
          ← Retour
        </Link>
      </main>
    )
  }

  const exerciseSlots = getExerciseSlots(chapter.profile, chapter.has_code)
  const profileLabel = chapter.profile === "programming" ? "Programmation" : chapter.profile === "theory" ? "Théorie" : "Mixte"
  const lang: Lang = chapter.code_lang || "none"
  const positionInCourse = allChapters.findIndex(c => c.id === chapter.id) + 1
  const totalChapters = allChapters.length
  const courseTitle = chapter.course_title
  const timeEstimate = estimateChapterTime(chapter.concepts.length, chapter.profile, chapter.has_code, realFlashcardCount)
  const phasesDone = (lessonOpened ? 1 : 0) + (flashcardsDone ? 1 : 0) + (completedExercises.size > 0 ? 1 : 0)
  const nextChapter = positionInCourse < totalChapters ? allChapters[positionInCourse] : null

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8 space-y-10">
      <ChapterCompleteCelebration
        open={showCelebration}
        onClose={() => setShowCelebration(false)}
        chapterTitle={chapter.title}
        nextHref={nextChapter ? `/etude/${chapter.study_course_id}/kapitel/${nextChapter.id}` : null}
        nextChapterTitle={nextChapter?.title ?? null}
      />

      {/* Breadcrumb + titre : un seul groupe visuel, séparé des phases
          par l'espacement du parent. */}
      <div className="space-y-4">
        <nav className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/etude" className="hover:text-foreground transition-colors">Étude</Link>
          <span>/</span>
          <Link href={`/etude/${chapter.study_course_id}`} className="hover:text-foreground transition-colors">
            {courseTitle}
          </Link>
          <span>/</span>
          <span className="text-foreground">Chapitre {positionInCourse}</span>
        </nav>

        {/* sm:flex-row : sur mobile le titre reste seul en tête (priorité
            de lecture), l'anneau de temps suit en dessous sur toute la
            largeur plutôt que de se battre avec le titre pour la place —
            à 375px, les deux côte à côte poussaient le titre en second
            plan visuel malgré sa priorité réelle. */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="text-xs">{profileLabel}</Badge>
              <Badge variant="outline" className="text-xs">Chapitre {positionInCourse}/{totalChapters}</Badge>
            </div>
            <h1 className="font-heading text-3xl font-bold tracking-tight text-balance">{chapter.title}</h1>
          </div>
          {/* Pas de temps à estimer pour un chapitre organisationnel — ce
              n'est pas du contenu à réviser (voir docs/db-anpassung.md §6bis). */}
          {!chapter.is_organizational && (
            <TimeRing estimate={timeEstimate} phasesDone={phasesDone} className="flex-shrink-0" />
          )}
        </div>
      </div>

      {chapter.is_organizational ? (
        /* Contenu organisationnel (plan de semestre, modalités d'examen,
           contacts...) — juste le résumé, aucune des trois phases
           d'apprentissage : pas de cours détaillé à générer, pas de
           flashcards, pas d'exercices à inventer sur du non-contenu. */
        <div className="flex items-start gap-3 rounded-lg border border-border/70 bg-muted/20 p-4">
          <Info className="h-5 w-5 flex-shrink-0 text-muted-foreground" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">Information de cours</p>
            <p className="text-sm leading-relaxed">{chapter.summary}</p>
          </div>
        </div>
      ) : (
      <>
      {/* Trois phases plutôt qu'une pile plate de blocs : l'étudiant qui
          arrive sur un chapitre voit dans quel ordre travailler
          (comprendre le contenu, puis le mémoriser, puis se tester)
          au lieu de quatre sections de même poids visuel. */}
      <StudyPhase
        step={1}
        title="Comprendre"
        subtitle="Le contenu du chapitre, expliqué et approfondi"
        tone="brand"
        done={lessonOpened}
      >
        {chapter.concepts.length > 0 && (
          <div className="rounded-lg border border-border/70 bg-card p-4">
            <h3 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-2">
              <Lightbulb className="h-4 w-4" /> Concepts couverts
            </h3>
            <div className="flex flex-wrap gap-2">
              {chapter.concepts.map(c => (
                <Badge
                  key={c}
                  variant="outline"
                  className="text-xs border-accent-brand/30 text-accent-brand transition-colors hover:bg-accent-brand/10"
                >
                  {c}
                </Badge>
              ))}
            </div>
          </div>
        )}
        <DetailedLessonView chapter={chapter} lang={lang} onOpenChange={o => o && setLessonOpened(true)} />
        <WebEnrichmentView chapter={chapter} />
      </StudyPhase>

      <StudyPhase
        step={2}
        title="Mémoriser"
        subtitle="Cartes recto-verso, révisées par répétition espacée"
        tone="warning"
        done={flashcardsDone}
      >
        <div className="rounded-lg border border-border/70 bg-card p-4">
          <FlashcardReview chapter={chapter} onSeriesComplete={() => setFlashcardsDone(true)} />
        </div>
      </StudyPhase>

      {/* Sélecteur d'exercice — jusqu'à 6 jeux possibles par chapitre
          (voir exercise-strategy.ts), tout empiler forçait un défilement
          interminable sans indiquer où commencer. Un seul jeu affiché à la
          fois, choisi explicitement, plutôt qu'un mur de composants.
          mcq/trueFalse/codeAnalysis existent dans exercise-strategy.ts
          (pondération pour pickNextExercise) mais n'ont pas d'UI dédiée —
          exclus de la liste, un onglet qui ne mène à rien serait trompeur. */}
      {(() => {
        const playableTypes = ["speedRound", "matching", "bugHunt", "conceptMap", "fillBlank", "code"] as const
        const playableSlots = exerciseSlots.filter(s => (playableTypes as readonly string[]).includes(s.type))
        if (playableSlots.length === 0) return null

        const ICONS: Record<string, React.ReactNode> = {
          speedRound: <Zap className="h-3.5 w-3.5" />,
          matching: <Link2 className="h-3.5 w-3.5" />,
          bugHunt: <Bug className="h-3.5 w-3.5" />,
          conceptMap: <Network className="h-3.5 w-3.5" />,
          fillBlank: <PenLine className="h-3.5 w-3.5" />,
          code: <Code2 className="h-3.5 w-3.5" />,
        }
        const LABELS: Record<string, string> = {
          speedRound: "Speed Round",
          matching: "Memory",
          bugHunt: "Bug Hunt",
          conceptMap: "Carte",
          fillBlank: "Texte à trous",
          code: "Complète",
        }

        return (
          <StudyPhase
            step={3}
            title="S'entraîner"
            subtitle={`${playableSlots.length} exercice${playableSlots.length > 1 ? "s" : ""} adapté${playableSlots.length > 1 ? "s" : ""} à ce chapitre`}
            tone="success"
            done={completedExercises.size > 0}
          >
            <Tabs
              value={activeExercise}
              onValueChange={v => {
                const next = v as string
                setActiveExercise(next)
                setVisitedExercises(prev => prev.has(next) ? prev : new Set(prev).add(next))
              }}
            >
              <TabsList className="h-auto flex-wrap justify-start gap-1 bg-muted/50 p-1">
                {playableSlots.map(slot => (
                  <TabsTrigger key={slot.type} value={slot.type} className="gap-1.5 px-2.5 py-1.5">
                    {ICONS[slot.type]} {LABELS[slot.type]}
                  </TabsTrigger>
                ))}
              </TabsList>
              {activeExercise === null && (
                <p className="pt-4 text-sm text-muted-foreground">
                  Choisis un exercice ci-dessus pour t&apos;entraîner.
                </p>
              )}
              {playableSlots.map(slot => (
                // keepMounted seulement une fois l'onglet visité : sans
                // ça, quitter un exercice en cours le démonterait
                // (comportement par défaut de base-ui) et régénérerait un
                // nouveau défi à chaque retour, avec un appel API inutile.
                // keepMounted=true en dur monterait les 6 exercices dès le
                // rendu de la phase, avant même le premier clic — d'où le
                // conditionnement sur visitedExercises plutôt qu'une prop
                // fixe.
                <TabsContent
                  key={slot.type}
                  value={slot.type}
                  keepMounted={visitedExercises.has(slot.type)}
                  className="pt-4"
                >
                  {slot.type === "speedRound" && (
                    <SpeedRound chapter={chapter} lang={lang} onComplete={() => markExerciseCompleted(slot.type)} />
                  )}
                  {slot.type === "matching" && (
                    <MemoryMatch chapter={chapter} onComplete={() => markExerciseCompleted(slot.type)} />
                  )}
                  {slot.type === "bugHunt" && (
                    <BugHunt chapter={chapter} onComplete={() => markExerciseCompleted(slot.type)} />
                  )}
                  {slot.type === "conceptMap" && (
                    <ConceptMap chapter={chapter} onComplete={() => markExerciseCompleted(slot.type)} />
                  )}
                  {slot.type === "fillBlank" && (
                    <FillBlank chapter={chapter} onComplete={() => markExerciseCompleted(slot.type)} />
                  )}
                  {slot.type === "code" && (
                    <CodeComplete chapter={chapter} onComplete={() => markExerciseCompleted(slot.type)} />
                  )}
                </TabsContent>
              ))}
            </Tabs>
          </StudyPhase>
        )
      })()}
      </>
      )}

      {/* Navigation between chapters */}
      {totalChapters > 1 && (
        <div className="flex items-center justify-between pt-4 border-t border-border/50">
          {positionInCourse > 1 ? (
            <Link
              href={`/etude/${chapter.study_course_id}/kapitel/${allChapters[positionInCourse - 2].id}`}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Chapitre précédent
            </Link>
          ) : <div />}
          {positionInCourse < totalChapters ? (
            <Link
              href={`/etude/${chapter.study_course_id}/kapitel/${allChapters[positionInCourse].id}`}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
            >
              Chapitre suivant <span className="text-xs">→</span>
            </Link>
          ) : <div />}
        </div>
      )}
    </main>
  )
}
