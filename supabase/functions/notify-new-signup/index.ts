// Edge Function déclenchée par un Database Webhook Supabase sur
// `insert` dans `auth.users` — envoie un email à l'admin (Ricky) pour
// qu'un nouveau compte inscrit ne reste pas indéfiniment en attente
// d'approbation sans que personne ne le sache (voir
// docs/db-anpassung.md §6quater : sans compte approuvé dans
// study_approved_users, un utilisateur voit l'interface mais ne peut
// créer aucun cours ni uploader de fichier).
//
// Le webhook est configuré côté dashboard Supabase (Database → Webhooks),
// pas dans ce fichier — voir docs/db-anpassung.md pour la marche à
// suivre exacte.
//
// Secrets requis (npx supabase secrets set ... — jamais dans .env.local,
// qui est lu par Next.js/Vercel, pas par les Edge Functions) :
// - RESEND_API_KEY
// - ADMIN_NOTIFICATION_EMAIL (adresse qui reçoit l'alerte)

interface WebhookPayload {
  type: "INSERT"
  table: string
  record: {
    id: string
    email: string | null
    created_at: string
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 })
  }

  const resendApiKey = Deno.env.get("RESEND_API_KEY")
  const adminEmail = Deno.env.get("ADMIN_NOTIFICATION_EMAIL")

  if (!resendApiKey || !adminEmail) {
    console.error("[notify-new-signup] secrets manquants (RESEND_API_KEY ou ADMIN_NOTIFICATION_EMAIL)")
    // 200 volontaire : une config manquante ne doit jamais faire échouer
    // le webhook Supabase de façon visible côté inscription utilisateur
    // (le webhook ne bloque pas signUp, mais autant rester silencieux
    // plutôt que de spammer les logs Supabase de retries).
    return new Response("ok", { status: 200 })
  }

  let payload: WebhookPayload
  try {
    payload = await req.json()
  } catch {
    return new Response("bad request", { status: 400 })
  }

  const email = payload.record?.email ?? "(email inconnu)"
  const userId = payload.record?.id ?? "(id inconnu)"

  // Distinct volontairement de l'email transactionnel Supabase (confirmation
  // de compte) — ceci part vers l'ADMIN, jamais vers le nouvel inscrit.
  const emailBody = `Nouvelle inscription sur it-learn :

Email : ${email}
User ID : ${userId}
Date : ${payload.record?.created_at ?? new Date().toISOString()}

Ce compte peut se connecter et voir l'interface, mais ne peut créer
aucun cours ni uploader de fichier jusqu'à approbation manuelle.

Pour l'activer, exécute dans le SQL Editor Supabase :

insert into public.study_approved_users (user_id)
select id from auth.users where email = '${email}'
on conflict (user_id) do nothing;`

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "it-learn <onboarding@resend.dev>",
      to: adminEmail,
      subject: `Nouvelle inscription en attente — ${email}`,
      text: emailBody,
    }),
  })

  if (!res.ok) {
    const detail = await res.text()
    console.error("[notify-new-signup] échec envoi Resend", res.status, detail)
    // 200 quand même : le webhook Supabase interpréterait un statut
    // d'erreur comme un échec à retenter, ce qui n'aiderait pas ici
    // (l'erreur vient de Resend, pas d'un problème transitoire côté
    // webhook) — l'échec reste visible dans les logs de la fonction.
    return new Response("ok", { status: 200 })
  }

  return new Response("ok", { status: 200 })
})
