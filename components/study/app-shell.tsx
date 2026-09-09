"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  Clock,
  FolderKanban,
  Menu,
  Settings,
  LogOut,
  ChevronUp,
  GraduationCap,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { getSupabaseClient } from "@/lib/supabase"
import { listStudyCourses } from "@/lib/study/queries"
import { PROFILE_UI } from "@/lib/study/profile-ui"
import type { StudyCourse } from "@/lib/study/types"
import type { User } from "@supabase/supabase-js"

function initialsFromEmail(email: string | null | undefined): string {
  if (!email) return "?"
  const name = email.split("@")[0]
  return name.slice(0, 2).toUpperCase()
}

interface Props {
  children: React.ReactNode
}

/**
 * Coquille du mode étude : sidebar fixe (desktop) / tiroir (mobile), liste
 * des cours, et bloc profil avec statut de connexion (voir docs/etude
 * design decisions — sidebar globale + page "Gérer mes cours" séparée,
 * pas un switcher d'onglets plat).
 */
export function AppShell({ children }: Props) {
  const pathname = usePathname()
  const router = useRouter()

  const [user, setUser] = useState<User | null>(null)
  const [courses, setCourses] = useState<StudyCourse[]>([])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const profileRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    Promise.resolve().then(async () => {
      const { data } = await getSupabaseClient().auth.getUser()
      setUser(data.user)
      if (data.user) {
        try {
          setCourses(await listStudyCourses(data.user.id))
        } catch {
          // La sidebar reste utilisable sans la liste des cours en cas d'erreur réseau.
        }
      }
    })
  }, [])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileMenuOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  useEffect(() => {
    Promise.resolve().then(() => setDrawerOpen(false))
  }, [pathname])

  async function handleLogout() {
    try { await getSupabaseClient().auth.signOut() } catch { /* ignore */ }
    router.push("/login")
  }

  const isToday = pathname === "/etude"
  const isManage = pathname === "/etude/dashboard"
  const pageTitle = isToday ? "Aujourd'hui" : isManage ? "Gérer mes cours" : "Chapitre"

  const navLinks = (
    <>
      <Link
        href="/etude"
        className={cn(
          "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors",
          isToday ? "bg-accent-brand/10 text-accent-brand" : "text-muted-foreground hover:bg-muted hover:text-foreground"
        )}
      >
        <Clock className="h-4 w-4 flex-shrink-0" />
        Aujourd&apos;hui
      </Link>
      <Link
        href="/etude/dashboard"
        className={cn(
          "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors",
          isManage ? "bg-accent-brand/10 text-accent-brand" : "text-muted-foreground hover:bg-muted hover:text-foreground"
        )}
      >
        <FolderKanban className="h-4 w-4 flex-shrink-0" />
        Gérer mes cours
      </Link>
    </>
  )

  const coursesList = (
    <div className="flex-1 space-y-0.5 overflow-y-auto px-2.5">
      {courses.map(course => (
        <Link
          key={course.id}
          href={`/etude/${course.id}`}
          className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <span className={cn("h-1.5 w-1.5 flex-shrink-0 rounded-full", PROFILE_UI[course.profile]?.dotColor ?? "bg-muted-foreground")} />
          <span className="min-w-0 flex-1 truncate">{course.title}</span>
        </Link>
      ))}
    </div>
  )

  const profileBlock = (
    <div ref={profileRef} className="relative border-t border-border p-2.5">
      {profileMenuOpen && (
        <div className="absolute bottom-[calc(100%+6px)] left-2.5 right-2.5 rounded-lg border border-border bg-card p-1.5 shadow-lg">
          <p className="truncate px-2.5 py-1.5 text-xs text-muted-foreground">{user?.email}</p>
          <Link
            href="/etude/dashboard"
            className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors hover:bg-muted"
          >
            <Settings className="h-3.5 w-3.5" />
            Paramètres du compte
          </Link>
          <div className="my-1 h-px bg-border" />
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm text-destructive transition-colors hover:bg-destructive/10"
          >
            <LogOut className="h-3.5 w-3.5" />
            Déconnexion
          </button>
        </div>
      )}
      <button
        onClick={() => setProfileMenuOpen(o => !o)}
        className="flex w-full items-center gap-2.5 rounded-md p-1.5 text-left transition-colors hover:bg-muted"
      >
        <div className="relative flex-shrink-0">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-accent-brand to-success text-[11px] font-bold text-white">
            {initialsFromEmail(user?.email)}
          </div>
          <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-success" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold leading-tight">
            {user?.email?.split("@")[0] ?? "…"}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            {user?.email ?? ""}
          </p>
        </div>
        <ChevronUp className={cn("h-3.5 w-3.5 flex-shrink-0 text-muted-foreground transition-transform", profileMenuOpen && "rotate-180")} />
      </button>
    </div>
  )

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Mobile topbar */}
      <div className="fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background px-3.5 md:hidden">
        <button
          onClick={() => setDrawerOpen(o => !o)}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border border-border"
          aria-label="Ouvrir le menu"
        >
          <Menu className="h-4 w-4" />
        </button>
        <span className="font-semibold">{pageTitle}</span>
        <div className="ml-auto flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent-brand to-success text-[10px] font-bold text-white">
          {initialsFromEmail(user?.email)}
        </div>
      </div>

      {drawerOpen && (
        <div
          className="fixed inset-0 top-14 z-30 bg-black/40 md:hidden"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-border bg-sidebar transition-transform md:static md:top-0 md:translate-x-0",
          drawerOpen ? "translate-x-0" : "-translate-x-full",
          "md:h-screen",
          "top-14 md:top-0"
        )}
      >
        <div className="flex items-center gap-2.5 px-3.5 py-4">
          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-accent-brand text-white">
            <GraduationCap className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-bold leading-tight">Étude</p>
            <p className="text-[10.5px] text-muted-foreground">IT Lernen</p>
          </div>
        </div>

        <nav className="space-y-0.5 px-2.5 pb-1">{navLinks}</nav>

        <p className="px-4 pb-1 pt-3.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
          Mes cours
        </p>
        {coursesList}

        {profileBlock}
      </aside>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto pt-14 md:pt-0">
        {children}
      </div>
    </div>
  )
}
