import { Check } from "lucide-react"
import { cn } from "@/lib/utils"

interface Props {
  /** 1, 2, 3 — encode la progression pédagogique réelle (comprendre puis
   * mémoriser puis s'entraîner), pas une numérotation décorative. */
  step: number
  title: string
  subtitle: string
  tone: "brand" | "warning" | "success"
  /** Phase entamée/terminée par l'étudiant — remplace le numéro par une
   * coche et allume le trait. Sans ce signal la page ne rendait aucun
   * sentiment d'avancement pendant la session : les trois phases avaient
   * exactement le même poids visuel du début à la fin. */
  done?: boolean
  children: React.ReactNode
}

const TONE: Record<Props["tone"], { badge: string; badgeDone: string; rule: string; ruleDone: string }> = {
  brand: { badge: "bg-accent-brand/12 text-accent-brand", badgeDone: "bg-accent-brand text-primary-foreground", rule: "bg-accent-brand/25", ruleDone: "bg-accent-brand/70" },
  warning: { badge: "bg-warning/12 text-warning", badgeDone: "bg-warning text-warning-foreground", rule: "bg-warning/25", ruleDone: "bg-warning/70" },
  success: { badge: "bg-success/12 text-success", badgeDone: "bg-success text-success-foreground", rule: "bg-success/25", ruleDone: "bg-success/70" },
}

/**
 * Une phase d'apprentissage sur la page chapitre. La page empilait avant
 * quatre blocs de même poids visuel (concepts, cours, sources, cartes,
 * exercices) sans indiquer par où commencer — les phases donnent un ordre
 * de parcours lisible d'un coup d'œil. Volontairement pas une Card : le
 * conteneur ne doit pas concurrencer visuellement les vraies cartes
 * (accordéons, exercices) qu'il contient.
 */
export function StudyPhase({ step, title, subtitle, tone, done = false, children }: Props) {
  const t = TONE[tone]

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums transition-colors duration-300",
            done ? t.badgeDone : t.badge,
          )}
        >
          {done ? <Check className="h-3.5 w-3.5" /> : step}
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold uppercase tracking-wide">{title}</h2>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <div className={cn("ml-1 h-px flex-1 rounded-full transition-colors duration-300", done ? t.ruleDone : t.rule)} />
        {done && (
          <span className="flex-shrink-0 animate-in fade-in text-[11px] font-medium text-muted-foreground duration-300">
            Fait
          </span>
        )}
      </div>

      <div className="space-y-4 sm:pl-10">{children}</div>
    </section>
  )
}
