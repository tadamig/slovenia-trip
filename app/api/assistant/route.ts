import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Asystent AI (opcjonalny dodatek). Odpowiada na pytania o Słowenię i miejsca
// z poradnika oraz układa plan dnia. Grounding: wyszukuje pasujące miejsca z
// guide_places (+ szczegóły) i wstrzykuje je jako kontekst do DeepSeek.
// Usuwalny razem z Asystentem (skasuj ten plik + AssistantTab + tabelę).
export const maxDuration = 60

const supa = createClient(
  (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim(),
  (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim(),
)

function norm(s: string | null | undefined): string {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/đ/g, 'd')
}
function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371, dLat = ((b.lat - a.lat) * Math.PI) / 180, dLon = ((b.lon - a.lon) * Math.PI) / 180
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
}

// Lekkie podpowiedzi intencji → kategorie (poprawiają trafność retrievalu).
const INTENT_CATS: { kw: string[]; cats: string[] }[] = [
  { kw: ['jedzenie', 'jesc', 'restau', 'obiad', 'kolacj', 'sniadan', 'kawa', 'lody', 'pizza', 'burger'], cats: ['restaurant'] },
  { kw: ['szlak', 'trekking', 'gory', 'wedrow', 'hiking', 'wodospad', 'jezioro', 'dolina', 'przelecz'], cats: ['trail', 'attraction'] },
  { kw: ['plaza', 'morze', 'kapiel', 'wybrzeze'], cats: ['beach'] },
  { kw: ['nocleg', 'spanie', 'hotel', 'apartament', 'glamping'], cats: ['lodging', 'camping'] },
  { kw: ['camping', 'kamper', 'namiot'], cats: ['camping'] },
  { kw: ['wino', 'winiar', 'degustac'], cats: ['wine'] },
  { kw: ['parking', 'zaparkowac'], cats: ['parking'] },
]

async function deepSeek(messages: any[]): Promise<string> {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), 50000)
  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        max_tokens: 1400,
        temperature: 0.4,
        response_format: { type: 'json_object' },
        messages,
      }),
      signal: controller.signal,
    })
    if (!res.ok) return ''
    const data = await res.json()
    return String(data?.choices?.[0]?.message?.content || '').trim()
  } catch {
    return ''
  } finally {
    clearTimeout(t)
  }
}

export async function POST(req: NextRequest) {
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }) }
  const history: { role: string; content: string }[] = Array.isArray(body?.messages) ? body.messages.slice(-8) : []
  const lastUser = [...history].reverse().find((m) => m.role === 'user')?.content || ''
  if (!lastUser.trim()) return NextResponse.json({ error: 'empty' }, { status: 400 })

  // —— Retrieval z poradnika ——
  const { data: placesData } = await supa
    .from('guide_places')
    .select('id,name,category,description,lat,lon,google_rating,google_place_id')
  const places = placesData || []

  const recentText = norm(history.slice(-3).map((m) => m.content).join(' '))
  const tokens = Array.from(new Set(norm(lastUser).split(/[^a-z0-9]+/).filter((t) => t.length >= 3)))
  const intentCats = new Set<string>()
  for (const it of INTENT_CATS) if (it.kw.some((k) => recentText.includes(k))) it.cats.forEach((c) => intentCats.add(c))

  // anchor lokalizacji: miejsce, którego nazwa pojawia się w zapytaniu
  let anchor: { lat: number; lon: number } | null = null
  let anchorScore = -1
  for (const p of places) {
    if (p.lat == null || p.lon == null) continue
    const nn = norm(p.name)
    const hit = tokens.some((t) => t.length >= 4 && nn.includes(t))
    if (hit && (p.google_rating || 0) > anchorScore) { anchor = { lat: p.lat, lon: p.lon }; anchorScore = p.google_rating || 0 }
  }

  const scored = places.map((p) => {
    const nn = norm(p.name), nd = norm(p.description)
    let s = 0
    for (const t of tokens) { if (nn.includes(t)) s += 3; if (nd.includes(t)) s += 1 }
    if (intentCats.size && intentCats.has(p.category)) s += 1.5
    let prox = 0
    if (anchor && p.lat != null && p.lon != null) {
      const d = haversineKm(anchor, { lat: p.lat, lon: p.lon })
      prox = d < 60 ? (60 - d) / 60 * 4 : 0   // do 4 pkt za bliskość (≤60 km)
    }
    return { p, score: s * 10 + prox + (p.google_rating || 0) * 0.05 }
  })
  scored.sort((a, b) => b.score - a.score)

  let top = scored.filter((x) => x.score > 0.6).slice(0, 40).map((x) => x.p)
  if (top.length < 8) {
    // zapytanie ogólne → dorzuć najwyżej oceniane miejsca
    const byRating = [...places].sort((a, b) => (b.google_rating || 0) - (a.google_rating || 0)).slice(0, 30)
    const seen = new Set(top.map((p) => p.id))
    for (const p of byRating) { if (!seen.has(p.id)) { top.push(p); seen.add(p.id) } }
    top = top.slice(0, 40)
  }

  // szczegóły (tipy/cena/godziny) dla najlepszych ~14, by AI mogło je wpleść
  const detailIds = top.slice(0, 14).map((p) => p.id)
  const { data: detData } = await supa.from('guide_place_details').select('guide_place_id,ai,google').in('guide_place_id', detailIds)
  const detById = new Map((detData || []).map((d: any) => [d.guide_place_id, d]))

  // —— Kontekst dla modelu ——
  const catLabel: Record<string, string> = {
    attraction: 'Atrakcja', restaurant: 'Jedzenie', beach: 'Plaża', trail: 'Szlak',
    wine: 'Winiarnia', camping: 'Camping', lodging: 'Nocleg', parking: 'Parking',
  }
  const lines = top.map((p, i) => {
    let line = `#${i + 1} [${catLabel[p.category] || p.category}] ${p.name}`
    if (p.google_rating) line += ` (ocena ${p.google_rating})`
    if (p.description) line += ` — ${p.description.slice(0, 200)}`
    const d: any = detById.get(p.id)
    if (d) {
      const extra: string[] = []
      if (d.ai?.czas) extra.push(`czas: ${d.ai.czas}`)
      if (d.ai?.cena || d.google?.price_txt) extra.push(`koszt: ${d.ai?.cena || d.google?.price_txt}`)
      if (Array.isArray(d.ai?.tipy) && d.ai.tipy.length) extra.push(`tip: ${d.ai.tipy[0]}`)
      if (extra.length) line += ` {${extra.join('; ')}}`
    }
    return line
  })

  const system =
    `Jesteś asystentem podróży po Słowenii dla naszej ekipy (wyprawa vanem). Odpowiadasz po polsku, ` +
    `konkretnie, rzeczowo i przyjaźnie. Masz poniżej listę miejsc z naszego poradnika (ponumerowaną #N). ` +
    `Korzystaj z tych miejsc, gdy pasują do pytania (odwołuj się do nich po nazwie); ogólną wiedzę o Słowenii ` +
    `dodawaj rozsądnie. NIE zmyślaj godzin otwarcia ani cen — jeśli nie masz danych w liście, nie podawaj konkretnych liczb. ` +
    `Gdy użytkownik prosi o plan dnia lub trasę, ułóż sensowną kolejność i dołącz pole "plan".\n\n` +
    `Zwróć WYŁĄCZNIE JSON w formacie:\n` +
    `{"reply": "<odpowiedź po polsku, markdown: krótkie akapity i listy zaczynane od '- '>", ` +
    `"plan": null | {"title": "<np. Dzień nad Bledem>", "stops": [{"ref": <numer #N z listy lub null>, "name": "<nazwa miejsca>", "note": "<krótko: co/dlaczego>", "duration_min": <liczba lub null>}]}}\n` +
    `Jeśli pytanie nie dotyczy planu/trasy, ustaw "plan": null. W stops preferuj miejsca z listy (pole ref).\n` +
    `WAŻNE: w treści "reply" NIE pokazuj numerów #N — są tylko do pola plan.ref. Pisz same nazwy miejsc.\n\n` +
    `MIEJSCA Z PORADNIKA:\n${lines.join('\n')}`

  const msgs = [{ role: 'system', content: system }, ...history.map((m) => ({ role: m.role, content: m.content }))]
  const raw = await deepSeek(msgs)

  let reply = ''
  let plan: any = null
  if (raw) {
    try {
      const obj = JSON.parse(raw.replace(/^```json\s*|^```\s*|```$/gim, '').trim())
      reply = typeof obj.reply === 'string' ? obj.reply.trim() : ''
      if (obj.plan && Array.isArray(obj.plan.stops)) {
        const stops = obj.plan.stops.map((st: any) => {
          const ref = Number.isInteger(st?.ref) ? st.ref : null
          const p = ref && ref >= 1 && ref <= top.length ? top[ref - 1] : null
          return {
            guide_place_id: p?.id || null,
            name: p?.name || String(st?.name || '').slice(0, 120),
            lat: p?.lat ?? null,
            lon: p?.lon ?? null,
            place_id: p?.google_place_id ?? null,
            note: st?.note ? String(st.note).slice(0, 200) : null,
            duration_min: Number.isFinite(st?.duration_min) ? Math.max(15, Math.min(480, st.duration_min)) : null,
          }
        }).filter((s: any) => s.name)
        if (stops.length) plan = { title: obj.plan.title ? String(obj.plan.title).slice(0, 80) : null, stops }
      }
    } catch { /* poniżej fallback */ }
  }
  if (!reply) reply = 'Przepraszam, nie udało mi się teraz odpowiedzieć. Spróbuj jeszcze raz lub zapytaj inaczej.'

  return NextResponse.json({ reply, plan })
}
