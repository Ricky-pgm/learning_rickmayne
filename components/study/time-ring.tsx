"use client"

import { Clock } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ChapterTimeEstimate } from "@/lib/study/time-estimate"

interface Props {
  estimate: ChapterTimeEstimate
  /** Combien de phases sur 3 sont faites (voir StudyPhase.done sur la
   * page chapitre) — fait avancer l'anneau, pas juste un décor statique. */
  phasesDone: number
  className?: string
}

const SIZE = 72
const STROKE = 6
const RADIUS = (SIZE - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/**
 * Anneau de progression façon minuteur — se remplit au fil des 3 phases
 * de la page chapitre plutôt que d'être un simple badge "~12 min" figé.
 * Purement dérivé de phasesDone : pas de vrai chronomètre (voir
 * time-estimate.ts), l'anneau représente l'avancement dans le plan de
 * révision, pas un décompte de secondes réelles.
 */
export function TimeRing({ estimate, phasesDone, className }: Props) {
  const progress = phasesDone / 3
  const dashOffset = CIRCUMFERENCE * (1 - progress)
  const remainingMinutes = Math.max(
    0,
    estimate.totalMinutes - Math.round((estimate.totalMinutes * phasesDone) / 3),
  )
  const done = phasesDone >= 3

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className="relative flex-shrink-0" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} className="-rotate-90">
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            strokeWidth={STROKE}
            className="stroke-muted"
          />
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
            className={cn(
              "transition-[stroke-dashoffset] duration-700 ease-out",
              done ? "stroke-success" : "stroke-accent-brand",
            )}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {done ? (
            <span className="text-[11px] font-semibold text-success">Fini</span>
          ) : (
            <>
              <span className="text-sm font-bold tabular-nums leading-none">{remainingMinutes}</span>
              <span className="text-[9px] text-muted-foreground leading-none mt-0.5">min</span>
            </>
          )}
        </div>
      </div>
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
          {done ? "Chapitre terminé" : `~${remainingMinutes} min restantes`}
        </p>
        <p className="text-xs text-muted-foreground">
          ~{estimate.totalMinutes} min au total · estimation
        </p>
      </div>
    </div>
  )
}
