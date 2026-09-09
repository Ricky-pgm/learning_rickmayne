import type { Metadata } from "next"
import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { Header } from "@/components/header"
import { AppFrame } from "@/components/app-frame"
import { Geist, Geist_Mono, Space_Grotesk } from "next/font/google"
import { cn } from "@/lib/utils"

const fontSans = Geist({ subsets: ["latin"], variable: "--font-sans" })
// Police d'affichage dédiée aux titres — auparavant identique à --font-sans
// (les deux chargeaient Geist), donc aucune vraie hiérarchie typographique
// entre titres et corps de texte. Space Grotesk apporte un vrai contraste
// (plus géométrique, personnalité propre) sans toucher à la lisibilité du
// corps — voir docs/design-audit-identite-visuelle.md, direction "C" validée.
const fontHeading = Space_Grotesk({ subsets: ["latin"], variable: "--font-heading", weight: ["500", "600", "700"] })
const fontMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono", weight: ["400"] })

export const metadata: Metadata = {
  title: "IT Lernen — Java & Langages dynamiques",
  description: "Plateforme de révision multi-cours (Java, Python, Perl, JavaScript) pour vos examens en Allemagne",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="fr"
      suppressHydrationWarning
      className={cn(fontSans.variable, fontHeading.variable, fontMono.variable)}
    >
      <body className="min-h-screen bg-background text-foreground antialiased overscroll-none">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <Header />
          <AppFrame>{children}</AppFrame>
        </ThemeProvider>
      </body>
    </html>
  )
}
