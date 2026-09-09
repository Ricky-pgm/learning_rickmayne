"use client"

import { useEffect, useState, useMemo } from "react"
import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Flame, ArrowRight, Zap, Star, CheckCircle, Clock, AlertCircle, BookOpen, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
import { getSupabaseClient } from "@/lib/supabase"
import {
  listAllStudyChaptersForUser,
  type StudyChapterWithCourse,
} from "@/lib/study/lesson-queries"
import { listStudyCourses } from "@/lib/study/queries"
import { getExerciseSlots } from "@/lib/study/exercise-strategy"
import { getExerciseHistory } from "@/lib/study/exercise-history-queries"
import { pickNextExercise } from "@/lib/study/next-up"
import { getStudyStreak, highestReachedMilestone, type StudyStreak } from "@/lib/study/streak"
import { StreakBadge } from "@/components/study/streak-badge"
import { MilestoneCelebration } from "@/components/study/milestone-celebration"
import type { StudyExerciseType } from "@/lib/study/types"

const SEEN_MILESTONE_KEY = "etude:lastSeenStreakMilestone"

const EXERCISE_LABELS: Record<StudyExerciseType, string> = {
  mcq: "un QCM",
  matching: "un appariement",
  trueFalse: "un vrai/faux",
  fillBlank: "un texte à trous",
  codeAnalysis: "une analyse de code",
  code: "un exercice de code",
  speedRound: "un Speed Round",
  bugHunt: "un Bug Hunt",
  conceptMap: "une carte de concepts",
}

interface CourseSummary {
  courseId: string
  title: string
  chapterCount: number
  doneCount: number
}

export default function EtudeDashboardPage() {
  const [chapters, setChapters] = useState<StudyChapterWithCourse[]>([])
  const [hasCourses, setHasCourses] = useState(false)
  const [streak, setStreak] = useState<StudyStreak | null>(null)
  const [celebratingMilestone, setCelebratingMilestone] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false
    async function run() {
      const { data: { user } } = await getSupabaseClient().auth.getUser()
      if (cancelled || !user) return
      try {
        // Distinguer "aucun cours créé" de "cours créé, chapitres pas encore
        // générés" — sans ça, les deux affichaient le même écran vide
        // trompeur ("Crée ton premier cours") alors que dans le second cas
        // le cours existe déjà, il manque juste l'étape de génération.
        const [all, courses, streakResult] = await Promise.all([
          listAllStudyChaptersForUser(user.id),
          listStudyCourses(user.id),
          getStudyStreak(user.id),
        ])
        if (cancelled) return
        setChapters(all)
        setHasCourses(courses.length > 0)
        setStreak(streakResult)

        // Célébration une seule fois par palier — mémorisé en localStorage
        // (purement cosmétique, pas grave si ça se rejoue sur un nouvel
        // appareil ; try/catch car localStorage peut lever en navigation
        // privée stricte sur certains navigateurs).
        const reached = highestReachedMilestone(streakResult.current)
        if (reached !== null) {
          try {
            const lastSeen = Number(localStorage.getItem(SEEN_MILESTONE_KEY) ?? "0")
            if (reached > lastSeen) setCelebratingMilestone(reached)
          } catch {
            // Pas de célébration si localStorage est inaccessible — jamais bloquant.
          }
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [])

  function closeCelebration() {
    if (celebratingMilestone !== null) {
      try {
        localStorage.setItem(SEEN_MILESTONE_KEY, String(celebratingMilestone))
      } catch {
        // Pas grave si ça ne persiste pas — au pire la célébration se rejoue.
      }
    }
    setCelebratingMilestone(null)
  }

  // Les chapitres organisationnels (plan de semestre, modalités d'examen...)
  // n'ont ni flashcards ni exercices — leur mastery_pct reste toujours à 0
  // sans que ça signifie "jamais exploré". Sans ce filtre, un plan de
  // semestre atterrirait dans "Pas encore explorés" et pourrait même
  // devenir la recommandation "Pour toi" avec un exercice inventé dessus.
  const contentChapters = useMemo(
    () => chapters.filter(c => !c.is_organizational),
    [chapters],
  )

  const dueChapters = useMemo(
    () => contentChapters.filter(c => c.next_review && new Date(c.next_review) <= new Date()),
    [contentChapters],
  )

  const neverExplored = useMemo(
    () => contentChapters.filter(c => c.mastery_pct === 0),
    [contentChapters],
  )

  const inProgress = useMemo(
    () => contentChapters.filter(c => c.mastery_pct > 0 && c.mastery_pct < 100),
    [contentChapters],
  )

  // Chapitre le plus prioritaire (même ordre que les sections ci-dessous :
  // à réviser d'abord, sinon en cours, sinon jamais exploré) — un seul
  // chapitre plutôt que d'interroger l'historique de tous, pour rester
  // léger sur cette page qui se recharge à chaque visite.
  const priorityChapter = dueChapters[0] ?? inProgress[0] ?? neverExplored[0] ?? null

  // chapterId associé au résultat, pour ignorer une recommandation
  // devenue obsolète si priorityChapter change avant la fin du fetch.
  const [nextExercise, setNextExercise] = useState<{ chapterId: string; type: StudyExerciseType } | null>(null)

  useEffect(() => {
    if (!priorityChapter) return
    let cancelled = false
    getExerciseHistory(priorityChapter.id)
      .then(history => {
        if (cancelled) return
        const slots = getExerciseSlots(priorityChapter.profile, priorityChapter.has_code)
        const candidates = slots.map(s => ({ studyChapterId: priorityChapter.id, exerciseType: s.type }))
        const mix = slots.map(s => ({ exerciseType: s.type, weight: s.weight }))
        const pick = pickNextExercise(candidates, mix, history)
        if (pick) setNextExercise({ chapterId: priorityChapter.id, type: pick.exerciseType as StudyExerciseType })
      })
      .catch(() => {
        // Recommandation best-effort — la page reste utilisable sans elle,
        // les sections À réviser/En cours/Pas exploré ci-dessous suffisent.
      })
    return () => { cancelled = true }
  }, [priorityChapter])

  const nextExerciseType =
    priorityChapter && nextExercise?.chapterId === priorityChapter.id ? nextExercise.type : null

  const courseSummaries = useMemo(() => {
    const map = new Map<string, CourseSummary>()
    for (const c of contentChapters) {
      if (!map.has(c.study_course_id)) {
        map.set(c.study_course_id, {
          courseId: c.study_course_id,
          title: c.course_title,
          chapterCount: 0,
          doneCount: 0,
        })
      }
      const s = map.get(c.study_course_id)!
      s.chapterCount++
      if (c.mastery_pct === 100) s.doneCount++
    }
    return Array.from(map.values())
  }, [contentChapters])

  const totalMastery = useMemo(() => {
    if (contentChapters.length === 0) return 0
    const sum = contentChapters.reduce((acc, c) => acc + c.mastery_pct, 0)
    return Math.round(sum / contentChapters.length)
  }, [contentChapters])

  if (loading) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="space-y-6">
          <div className="h-8 w-48 rounded bg-muted/60 animate-pulse" />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-24 rounded-lg bg-muted/40 animate-pulse" />
            ))}
          </div>
        </div>
      </main>
    )
  }

  if (error) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      </main>
    )
  }

  if (chapters.length === 0) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <h1 className="font-heading text-3xl font-bold tracking-tight mb-8">Étude</h1>
        <Card className="border-dashed border-2 border-muted-foreground/20 bg-muted/10">
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-brand/10">
              <BookOpen className="h-6 w-6 text-accent-brand" />
            </div>
            {hasCourses ? (
              <div className="space-y-1">
                <p className="text-lg font-semibold">Aucun chapitre généré pour l&apos;instant</p>
                <p className="text-sm text-muted-foreground max-w-sm">
                  Ton cours existe déjà — il manque juste l&apos;étape de génération. Ouvre-le pour lancer la génération des chapitres à partir du PDF importé.
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                <p className="text-lg font-semibold">Aucun cours encore</p>
                <p className="text-sm text-muted-foreground max-w-sm">
                  Crée ton premier cours dans le tableau de bord pour commencer à réviser.
                </p>
              </div>
            )}
            <Link href="/etude/dashboard">
              <Button>
                {hasCourses ? "Voir mes cours" : "Créer un cours"} <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8 space-y-10">
      <MilestoneCelebration milestone={celebratingMilestone} onClose={closeCelebration} />

      {/* Header with streak & progress */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight">Aujourd&apos;hui</h1>
          <p className="text-muted-foreground mt-1">
            {dueChapters.length > 0
              ? `${dueChapters.length} carte${dueChapters.length > 1 ? "s" : ""} à réviser`
              : "Tout est à jour — bravo !"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {streak && <StreakBadge streak={streak} />}
          <Link href="/etude/dashboard">
            <Button variant="outline" size="sm" className="gap-2">
              <Star className="h-4 w-4" /> Gérer mes cours
            </Button>
          </Link>
        </div>
      </div>

      {/* Prochain exercice recommandé — pondéré par pickNextExercise selon
          le dosage du profil et le taux de réussite réel déjà observé sur
          ce chapitre (lib/study/next-up.ts). Pointe vers le chapitre plutôt
          qu'un type d'exercice précis : seul le Speed Round a une UI
          dédiée aujourd'hui, les autres types n'ont qu'un badge sur la
          page chapitre. */}
      {priorityChapter && nextExerciseType && (
        // mb-10 explicite en plus du space-y-10 du parent : le dégradé
        // clair de cette carte contre le fond blanc de la page rendait
        // l'espace réel (déjà là via space-y-10) peu perceptible à l'œil —
        // l'écart doit être sans ambiguïté entre la recommandation et les
        // stats qui suivent.
        <Link href={`/etude/${priorityChapter.study_course_id}/kapitel/${priorityChapter.id}`} className="block mb-10">
          <Card className="group/reco relative overflow-hidden border border-accent-brand/20 bg-gradient-to-br from-accent-brand/10 via-accent-brand/5 to-transparent shadow-none transition-all hover:border-accent-brand/40 hover:shadow-md hover:shadow-accent-brand/5 cursor-pointer">
            <CardContent className="flex items-center gap-3.5 p-4 sm:p-5">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-accent-brand/15 text-accent-brand transition-transform group-hover/reco:scale-105 group-hover/reco:rotate-3">
                <Sparkles className="h-4.5 w-4.5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-accent-brand/80">Recommandé pour toi</p>
                {/* truncate sur un span inline ne coupe rien tant que le
                    <p> parent n'a pas lui-même une largeur contrainte —
                    sur mobile avec un titre de chapitre long, ça débordait
                    ou wrappait sur 2-3 lignes au lieu de tronquer proprement. */}
                <p className="truncate text-sm font-medium mt-0.5">
                  {EXERCISE_LABELS[nextExerciseType]} sur {priorityChapter.title}
                </p>
                <p className="text-xs text-muted-foreground truncate">{priorityChapter.course_title}</p>
              </div>
              <ArrowRight className="h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform group-hover/reco:translate-x-0.5" />
            </CardContent>
          </Card>
        </Link>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          icon={<Flame className="h-5 w-5 text-warning" />}
          label="Chapitres"
          value={contentChapters.length}
          tone="default"
        />
        <StatCard
          icon={<CheckCircle className="h-5 w-5 text-success" />}
          label="Maîtrisés"
          value={contentChapters.filter(c => c.mastery_pct === 100).length}
          tone="success"
        />
        <StatCard
          icon={<Zap className="h-5 w-5 text-accent-brand" />}
          label="Moy. maîtrise"
          value={`${totalMastery}%`}
          tone="brand"
        />
        <StatCard
          icon={<Clock className="h-5 w-5 text-warning" />}
          label="À réviser"
          value={dueChapters.length}
          tone="warning"
        />
      </div>

      {/* Chaque section vit dans son propre bloc (fond + bordure) plutôt
          qu'un simple titre suivi de cartes à même la page — sans ça, rien
          ne distingue visuellement où une catégorie finit et où la
          suivante commence, seul l'espacement du parent les séparait.
          Entrée échelonnée (delay croissant) plutôt que tout d'un coup —
          guide l'œil dans l'ordre de priorité réel des sections. */}
      <div className="space-y-6">
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
          <DashboardSection
            title="À réviser"
            icon={<Clock className="h-4 w-4 text-warning" />}
            count={dueChapters.length}
            shown={Math.min(dueChapters.length, 5)}
            tone="warning"
          >
            {dueChapters.slice(0, 5).map(ch => (
              <ChapterCard key={ch.id} chapter={ch} showDue />
            ))}
          </DashboardSection>
        </div>

        <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 [animation-delay:75ms] fill-mode-both">
          <DashboardSection
            title="En cours"
            icon={<Zap className="h-4 w-4 text-accent-brand" />}
            count={inProgress.length}
            shown={Math.min(inProgress.length, 5)}
            tone="brand"
          >
            {inProgress.slice(0, 5).map(ch => (
              <ChapterCard key={ch.id} chapter={ch} />
            ))}
          </DashboardSection>
        </div>

        <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 [animation-delay:150ms] fill-mode-both">
          <DashboardSection
            title="Pas encore explorés"
            icon={<AlertCircle className="h-4 w-4 text-muted-foreground" />}
            count={neverExplored.length}
            shown={Math.min(neverExplored.length, 5)}
            tone="default"
          >
            {neverExplored.slice(0, 5).map(ch => (
              <ChapterCard key={ch.id} chapter={ch} showNew />
            ))}
          </DashboardSection>
        </div>
      </div>

      {/* Course summaries */}
      {courseSummaries.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3">Mes cours</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {courseSummaries.map(s => (
              <Link key={s.courseId} href={`/etude/${s.courseId}`}>
                <Card className="border border-border/70 bg-card shadow-none transition-colors hover:border-accent-brand/40 cursor-pointer h-full">
                  <CardContent className="p-4">
                    <p className="font-semibold truncate">{s.title}</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {s.doneCount}/{s.chapterCount} chapitres maîtrisés
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}
    </main>
  )
}

/* ---------- helpers ---------- */

function StatCard({ icon, label, value, tone }: {
  icon: React.ReactNode
  label: string
  value: number | string
  tone: "default" | "success" | "brand" | "warning"
}) {
  const bg: Record<string, string> = {
    default: "bg-muted/40",
    success: "bg-success/10",
    brand: "bg-accent-brand/10",
    warning: "bg-warning/10",
  }
  return (
    <Card className={cn(
      "border border-border/50 shadow-none transition-all hover:-translate-y-0.5 hover:shadow-sm",
      bg[tone],
    )}>
      <CardContent className="flex items-center gap-3 p-3.5">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-background/80">
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-2xl font-bold leading-tight tabular-nums">{value}</p>
          <p className="text-xs text-muted-foreground truncate">{label}</p>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * Regroupe une catégorie de chapitres (À réviser / En cours / Pas encore
 * explorés) dans un bloc visuellement distinct — fond + bordure teintés
 * selon `tone` — plutôt qu'un simple titre suivi de cartes à même la
 * page : sans conteneur propre, rien ne marque où une section finit et
 * où la suivante commence. N'affiche rien si la catégorie est vide.
 */
function DashboardSection({
  title,
  icon,
  count,
  shown,
  tone,
  children,
}: {
  title: string
  icon: React.ReactNode
  count: number
  /** Nombre réellement affiché dans `children` (slice(0, 5) côté appelant)
   * — sans lui, le badge affichait le total (ex. 58) alors que seules 5
   * cartes sont listées, ce qui semblait faux au premier coup d'œil. */
  shown: number
  tone: "warning" | "brand" | "default"
  children: React.ReactNode
}) {
  if (count === 0) return null

  const toneClasses: Record<typeof tone, string> = {
    warning: "border-warning/20 bg-warning/[0.03]",
    brand: "border-accent-brand/20 bg-accent-brand/[0.03]",
    default: "border-border/60 bg-muted/10",
  }

  return (
    <section className={cn("rounded-xl border p-4 sm:p-5", toneClasses[tone])}>
      <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {icon} {title}
        <span className="font-mono text-xs font-normal tabular-nums text-muted-foreground/70">
          {shown < count ? `${shown}/${count}` : count}
        </span>
      </h2>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

function ChapterCard({
  chapter,
  showDue,
  showNew,
}: {
  chapter: StudyChapterWithCourse
  showDue?: boolean
  showNew?: boolean
}) {
  return (
    <Link href={`/etude/${chapter.study_course_id}/kapitel/${chapter.id}`}>
      <Card className="overflow-hidden border border-border/70 bg-card shadow-none transition-all hover:border-accent-brand/40 hover:shadow-sm cursor-pointer p-0">
        <CardContent className="flex items-stretch gap-0 p-0">
          {/* Bande de catégorie — encode l'état d'un coup d'œil, avant
              même de lire le badge texte. */}
          <div className={cn(
            "w-1 flex-shrink-0",
            showDue ? "bg-warning" : showNew ? "bg-accent-brand" : "bg-border",
          )} />
          <div className="flex min-w-0 flex-1 items-center justify-between gap-3 px-3.5 py-3 sm:px-4">
            <div className="min-w-0 flex-1">
              <p className="font-semibold truncate">{chapter.title}</p>
              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                {chapter.course_title} · Maîtrise {chapter.mastery_pct}%
              </p>
            </div>
            <div className="flex flex-shrink-0 items-center gap-2">
              {showDue && (
                <Badge variant="outline" className="text-xs border-warning/40 text-warning">
                  À réviser
                </Badge>
              )}
              {showNew && (
                <Badge variant="outline" className="text-xs border-accent-brand/40 text-accent-brand">
                  Nouveau
                </Badge>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}


