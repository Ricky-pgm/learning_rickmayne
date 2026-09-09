"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Alert, AlertDescription, AlertAction } from "@/components/ui/alert"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import {
  ArrowLeft, Plus, FileText, Trash2, AlertCircle,
  CheckCircle2, BookOpen, FileUp, ArrowRight, CalendarDays, Download,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { getSupabaseClient } from "@/lib/supabase"
import { getApiErrorMessage } from "@/lib/api-errors"
import { listCourses, createCourse, deleteCourse, listFiles, uploadFile, deleteFile, setCourseExamDate } from "@/lib/study/queries"
import { listAllStudyChaptersForUser } from "@/lib/study/lesson-queries"
import { buildExamSchedule } from "@/lib/study/exam-schedule"
import { buildICS } from "@/lib/study/ics-export"
import { PROFILE_UI } from "@/lib/study/profile-ui"
import type { CourseProfile, StudyCourse, StudyCourseFile } from "@/lib/study/types"

export default function EtudeDashboardManager() {
  const [userId, setUserId] = useState<string | null>(null)
  const [coursesLoaded, setCoursesLoaded] = useState(false)
  const [courses, setCourses] = useState<StudyCourse[]>([])
  const [selectedCourse, setSelectedCourse] = useState<StudyCourse | null>(null)
  const [files, setFiles] = useState<StudyCourseFile[]>([])

  const [newTitle, setNewTitle] = useState("")
  const [newProfile, setNewProfile] = useState<CourseProfile>("mixed")
  const [creating, setCreating] = useState(false)

  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")

  useEffect(() => {
    getSupabaseClient().auth.getUser().then(({ data }) => {
      setUserId(data.user?.id ?? null)
    })
  }, [])

  const loadCourses = useCallback(async () => {
    if (!userId) return
    try {
      setCourses(await listCourses(userId))
    } catch (e) {
      setError(getApiErrorMessage(e instanceof Error ? e.message : String(e)))
    } finally {
      setCoursesLoaded(true)
    }
  }, [userId])

  useEffect(() => {
    Promise.resolve().then(() => loadCourses())
  }, [loadCourses])

  const loadFiles = useCallback(async (course: StudyCourse) => {
    try {
      setFiles(await listFiles(course.id))
    } catch (e) {
      setError(getApiErrorMessage(e instanceof Error ? e.message : String(e)))
    }
  }, [])

  useEffect(() => {
    if (!selectedCourse) return
    Promise.resolve().then(() => loadFiles(selectedCourse))
  }, [selectedCourse, loadFiles])

  function clearMessages() { setError(""); setSuccess("") }

  async function handleCreate() {
    if (!userId || !newTitle.trim()) return
    clearMessages()
    setCreating(true)
    try {
      const course = await createCourse(userId, newTitle.trim(), newProfile)
      setCourses(prev => [...prev, course])
      setNewTitle("")
      setSelectedCourse(course)
      setSuccess("Cours créé — tu peux y ajouter des fichiers PDF maintenant.")
    } catch (e) {
      setError(getApiErrorMessage(e instanceof Error ? e.message : String(e)))
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete(courseId: string) {
    if (!confirm("Supprimer ce cours et tous ses fichiers ?")) return
    clearMessages()
    try {
      await deleteCourse(courseId)
      setCourses(prev => prev.filter(c => c.id !== courseId))
      if (selectedCourse?.id === courseId) setSelectedCourse(null)
    } catch (e) {
      setError(getApiErrorMessage(e instanceof Error ? e.message : String(e)))
    }
  }

  async function handleDeleteFile(fileId: string) {
    if (!selectedCourse) return
    if (!confirm("Supprimer ce fichier ?")) return
    clearMessages()
    try {
      await deleteFile(selectedCourse.id, fileId)
      setFiles(prev => prev.filter(f => f.id !== fileId))
    } catch (e) {
      setError(getApiErrorMessage(e instanceof Error ? e.message : String(e)))
    }
  }

  async function handleUpload(fileList: FileList | null) {
    if (!selectedCourse || !fileList?.length) return
    clearMessages()
    setUploading(true)
    try {
      for (const file of Array.from(fileList)) {
        await uploadFile(selectedCourse.id, file)
      }
      setSuccess(`${fileList.length} fichier${fileList.length > 1 ? "s" : ""} importé${fileList.length > 1 ? "s" : ""}.`)
      await loadFiles(selectedCourse)
    } catch (e) {
      setError(getApiErrorMessage(e instanceof Error ? e.message : String(e)))
    } finally {
      setUploading(false)
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    handleUpload(e.dataTransfer.files)
  }

  const [examDateDraft, setExamDateDraft] = useState<string>("")
  const [savingExamDate, setSavingExamDate] = useState(false)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    setExamDateDraft(selectedCourse?.exam_date ?? "")
  }, [selectedCourse])

  async function handleSaveExamDate() {
    if (!selectedCourse) return
    clearMessages()
    setSavingExamDate(true)
    try {
      const value = examDateDraft.trim() || null
      await setCourseExamDate(selectedCourse.id, value)
      setCourses(prev => prev.map(c => c.id === selectedCourse.id ? { ...c, exam_date: value } : c))
      setSelectedCourse(prev => prev ? { ...prev, exam_date: value } : prev)
      setSuccess(value ? "Date d'examen enregistrée." : "Date d'examen effacée.")
    } catch (e) {
      setError(getApiErrorMessage(e instanceof Error ? e.message : String(e)))
    } finally {
      setSavingExamDate(false)
    }
  }

  // Génère le planning de révision et déclenche le téléchargement du
  // .ics — pas de saveAs/lib externe : un blob + <a download> suffit
  // pour un fichier texte simple comme l'iCalendar.
  async function handleExportSchedule() {
    if (!selectedCourse?.exam_date || !userId) return
    clearMessages()
    setExporting(true)
    try {
      const allChapters = await listAllStudyChaptersForUser(userId)
      const courseChapters = allChapters.filter(c => c.study_course_id === selectedCourse.id)
      const schedule = buildExamSchedule(courseChapters, selectedCourse.exam_date)
      if (schedule.length === 0) {
        setSuccess("Rien à planifier — tous les chapitres sont déjà maîtrisés, ou aucun chapitre généré pour ce cours.")
        return
      }
      const ics = buildICS(selectedCourse.title, selectedCourse.exam_date, schedule)
      const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${selectedCourse.title.replace(/\s+/g, "-")}-revisions.ics`
      a.click()
      URL.revokeObjectURL(url)
      setSuccess(`Planning exporté — ${schedule.length} jour${schedule.length > 1 ? "s" : ""} de révision programmé${schedule.length > 1 ? "s" : ""}.`)
    } catch (e) {
      setError(getApiErrorMessage(e instanceof Error ? e.message : String(e)))
    } finally {
      setExporting(false)
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8 space-y-6">
      <Link href="/etude" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-3.5 w-3.5" /> Retour à Étude
      </Link>

      <div>
        <h1 className="text-3xl font-bold tracking-tight">Gérer mes cours</h1>
        <p className="text-muted-foreground mt-1">Crée, importe et organise tes contenus d&apos;étude.</p>
      </div>

      {error && (
        <Alert variant="destructive" className="items-center gap-3">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
          <AlertAction onClick={clearMessages}>OK</AlertAction>
        </Alert>
      )}

      {success && (
        <Alert className="items-center gap-3 border-success/30 bg-success/5">
          <CheckCircle2 className="text-success" />
          <AlertDescription className="text-success">{success}</AlertDescription>
          <AlertAction onClick={clearMessages}>OK</AlertAction>
        </Alert>
      )}

      {/* Create form */}
      <Card className="border border-border/70 bg-card shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Plus className="h-4 w-4" /> Nouveau cours
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="course-title">Titre du cours</Label>
            <Input
              id="course-title"
              placeholder="Ex. Droit pénal général"
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleCreate() }}
            />
          </div>

          <div className="space-y-2">
            <Label>Profil</Label>
            <div className="grid grid-cols-3 gap-2">
              {(Object.entries(PROFILE_UI) as [CourseProfile, typeof PROFILE_UI[CourseProfile]][]).map(([key, { label, description, icon: Icon, dotColor }]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setNewProfile(key)}
                  className={cn(
                    "group relative overflow-hidden rounded-lg border p-3 text-left transition-all",
                    newProfile === key
                      ? "border-ring bg-ring/10 shadow-sm"
                      : "border-border/70 hover:border-ring/40 hover:bg-muted/40",
                  )}
                >
                  {/* Pastille de couleur du profil plutôt qu'un simple
                      contour sélectionné : la même teinte réapparaît sur
                      la carte du cours une fois créé (bande latérale) et
                      sur ChapterCard — un même code couleur traverse toute
                      l'app plutôt que de s'arrêter à cet écran. */}
                  <span className={cn("absolute right-2 top-2 h-1.5 w-1.5 rounded-full transition-transform", dotColor, newProfile === key ? "scale-125" : "scale-100 opacity-50")} />
                  <Icon className={cn("h-5 w-5 transition-colors", newProfile === key ? "text-ring" : "text-muted-foreground")} />
                  <p className="text-sm font-medium mt-1">{label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
                </button>
              ))}
            </div>
          </div>

          <Button onClick={handleCreate} disabled={!newTitle.trim() || creating} className="w-full sm:w-auto">
            {creating ? <Spinner className="mr-2 size-4" /> : <Plus className="mr-2 h-4 w-4" />}
            Créer le cours
          </Button>
        </CardContent>
      </Card>

      <Separator />

      {/* Existing courses */}
      <section>
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <BookOpen className="h-5 w-5" /> Mes cours ({courses.length})
        </h2>

        {!coursesLoaded && (
          <div className="space-y-2">
            {[1, 2].map(i => (
              <div key={i} className="h-[68px] rounded-lg bg-muted/40 animate-pulse" />
            ))}
          </div>
        )}

        {coursesLoaded && courses.length === 0 && (
          <Card className="border-dashed border-2 border-muted-foreground/20 bg-muted/10">
            <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
              <FileText className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">Aucun cours pour l&apos;instant.</p>
            </CardContent>
          </Card>
        )}

        <div className="space-y-2">
          {courses.map((course, i) => {
            const isSelected = selectedCourse?.id === course.id
            const profileInfo = PROFILE_UI[course.profile]
            return (
              <div
                key={course.id}
                className="animate-in fade-in slide-in-from-bottom-1 duration-300 fill-mode-both"
                style={{ animationDelay: `${Math.min(i, 6) * 40}ms` }}
              >
                <Card
                  className={cn(
                    "overflow-hidden border bg-card p-0 shadow-none transition-all cursor-pointer",
                    isSelected ? "border-ring shadow-sm" : "border-border/70 hover:border-ring/40",
                  )}
                  onClick={() => setSelectedCourse(isSelected ? null : course)}
                >
                  <CardContent className="flex items-stretch gap-0 p-0">
                    {/* Même code couleur que le sélecteur de profil et
                        ChapterCard — la teinte d'un cours reste
                        reconnaissable d'un écran à l'autre. */}
                    <div className={cn("w-1 flex-shrink-0", profileInfo.dotColor)} />
                    <div className="flex min-w-0 flex-1 items-center justify-between gap-3 px-3.5 py-3.5 sm:px-4">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold truncate">{course.title}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="secondary" className="gap-1 text-xs">
                            <profileInfo.icon className="h-3 w-3" /> {profileInfo.label}
                          </Badge>
                          {course.exam_date && (
                            <Badge variant="outline" className="gap-1 text-xs border-warning/30 text-warning">
                              <CalendarDays className="h-3 w-3" /> {new Date(course.exam_date + "T00:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                          onClick={(e) => { e.stopPropagation(); handleDelete(course.id) }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                        <ArrowRight
                          className={cn(
                            "h-4 w-4 text-muted-foreground transition-transform duration-200",
                            isSelected && "rotate-90",
                          )}
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Expanded file section — panneau propre plutôt qu'un
                    simple retrait indenté, cohérent avec le traitement
                    "phase" du reste de l'app (fond + bordure teintés). */}
                {isSelected && (
                  <div className="animate-in fade-in slide-in-from-top-1 mt-2 space-y-4 rounded-lg border border-ring/20 bg-ring/[0.03] p-4 duration-200">
                    {/* Date d'examen + export du planning de révision —
                        saisie manuelle (voir docs/db-anpassung.md §3ter),
                        pas d'extraction automatique depuis un planning
                        PDF, trop fragile à parser de façon fiable. */}
                    <div className="space-y-2">
                      <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                        <CalendarDays className="h-3.5 w-3.5" /> Date d&apos;examen
                      </h3>
                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          type="date"
                          value={examDateDraft}
                          onChange={e => setExamDateDraft(e.target.value)}
                          className="w-auto bg-card"
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleSaveExamDate}
                          disabled={savingExamDate || examDateDraft === (course.exam_date ?? "")}
                        >
                          {savingExamDate ? <Spinner className="size-4" /> : "Enregistrer"}
                        </Button>
                        {course.exam_date && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1.5"
                            onClick={handleExportSchedule}
                            disabled={exporting}
                          >
                            {exporting ? <Spinner className="size-4" /> : <Download className="h-3.5 w-3.5" />}
                            Exporter le planning de révision (.ics)
                          </Button>
                        )}
                      </div>
                    </div>

                    <h3 className="text-sm font-medium text-muted-foreground">
                      Fichiers ({files.length})
                    </h3>

                    {/* Drop zone */}
                    <div
                      onDragOver={e => { e.preventDefault(); setDragging(true) }}
                      onDragLeave={() => setDragging(false)}
                      onDrop={handleDrop}
                      className={cn(
                        "relative flex flex-col items-center gap-2 rounded-lg border-2 border-dashed p-6 text-center transition-all",
                        dragging
                          ? "scale-[1.01] border-ring bg-ring/10"
                          : "border-border/50 bg-card hover:border-ring/40 hover:bg-muted/20",
                      )}
                    >
                      <FileUp className={cn("h-8 w-8 transition-transform", dragging ? "scale-110 text-ring" : "text-muted-foreground/50")} />
                      <p className="text-sm text-muted-foreground">
                        {uploading ? (
                          <span className="flex items-center gap-2"><Spinner className="size-4" /> Importation…</span>
                        ) : (
                          "Glisse un PDF ici ou "
                        )}
                      </p>
                      {!uploading && (
                        <label className="cursor-pointer text-sm font-medium text-ring hover:underline">
                          parcourir
                          <input
                            type="file"
                            multiple
                            accept=".pdf"
                            className="sr-only"
                            onChange={e => handleUpload(e.target.files)}
                          />
                        </label>
                      )}
                    </div>

                    {/* File list */}
                    {files.length > 0 && (
                      <div className="space-y-1">
                        {files.map(f => (
                          <div key={f.id} className="group flex items-center gap-2.5 rounded-md bg-card px-3 py-2 transition-colors hover:bg-muted/40">
                            <FileText className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/60" />
                            <span className="min-w-0 flex-1 truncate text-sm">{f.file_name}</span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 flex-shrink-0 p-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
                              onClick={(e) => { e.stopPropagation(); handleDeleteFile(f.id) }}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}

                    {files.length > 0 && (
                      <Link href={`/etude/${course.id}`}>
                        <Button variant="outline" size="sm" className="w-full gap-2 bg-card">
                          Voir les chapitres <ArrowRight className="h-3.5 w-3.5" />
                        </Button>
                      </Link>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>
    </main>
  )
}
