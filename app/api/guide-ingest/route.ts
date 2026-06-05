import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Jednorazowy ingest dla Przewodnika (opcjonalny dodatek). Używa kluczy z Vercela
// (DeepSeek, Google Places, service role). Chroniony INGEST_SECRET. Usuwalny razem
// z całym Przewodnikiem (skasuj ten plik + GuideTab + tabelę guide_places).
export const maxDuration = 60

const supa = createClient(
  (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim(),
  (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim(),
)
const GKEY = process.env.GOOGLE_PLACES_API_KEY

function authed(req: NextRequest): boolean {
  const got = req.headers.get('x-ingest-secret') || ''
  return !!process.env.INGEST_SECRET && got === process.env.INGEST_SECRET
}

async function deepSeek(prompt: string): Promise<string> {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), 40000)
  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        max_tokens: 220,
        messages: [
          { role: 'system', content: 'Jesteś redaktorem przewodnika. Odpowiadasz wyłącznie po polsku, zwięźle.' },
          { role: 'user', content: prompt },
        ],
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

async function summarize(name: string, text: string): Promise<string | null> {
  const prompt =
    `Poniżej fragment(y) przewodnika po Słowenii. Jeśli OPISUJĄ miejsce „${name}", napisz 1–2 zdaniowe, rzeczowe streszczenie po polsku (sam opis, bez nazwy na początku, bez cen i linków). ` +
    `Jeśli fragment NIE dotyczy „${name}" (np. to inne miejsce, spis treści, indeks), odpowiedz dokładnie: BRAK.\n\nFRAGMENT:\n${text.slice(0, 1600)}`
  const out = await deepSeek(prompt)
  if (!out) return null
  const clean = out.replace(/^["„]+|["”]+$/g, '').trim()
  if (/^BRAK/i.test(clean) || clean.length < 20) return null
  return clean.slice(0, 400)
}

async function findPlace(name: string, lat: number | null, lon: number | null) {
  if (!GKEY) return null
  const bias = lat != null && lon != null ? `&locationbias=point:${lat},${lon}` : ''
  const url =
    `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(name)}` +
    `&inputtype=textquery&fields=place_id,rating,user_ratings_total${bias}&key=${GKEY}`
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const data = await res.json()
    const c = data?.candidates?.[0]
    if (!c) return null
    return { place_id: c.place_id || null, rating: c.rating ?? null, total: c.user_ratings_total ?? null }
  } catch {
    return null
  }
}

export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { searchParams } = new URL(req.url)
  const mode = searchParams.get('mode')

  if (mode === 'ratings') {
    const { data } = await supa.from('guide_places').select('id,name,lat,lon').is('google_rating', null).limit(30)
    const rows = data || []
    let updated = 0
    for (const p of rows) {
      const r = await findPlace(p.name, p.lat, p.lon)
      if (r && r.rating != null) {
        await supa.from('guide_places').update({ google_place_id: r.place_id, google_rating: r.rating, google_total_ratings: r.total }).eq('id', p.id)
        updated++
      } else {
        // oznacz jako przetworzone (rating 0), by nie zapętlać; UI nie pokaże 0 jako oceny < 1
        await supa.from('guide_places').update({ google_rating: 0 }).eq('id', p.id)
      }
    }
    const { count } = await supa.from('guide_places').select('id', { count: 'exact', head: true }).is('google_rating', null)
    return NextResponse.json({ mode, processed: rows.length, updated, remaining: count ?? 0 })
  }

  if (mode === 'descriptions') {
    let body: any
    try { body = await req.json() } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }) }
    const items: { name: string; text: string }[] = Array.isArray(body?.items) ? body.items : []
    let updated = 0
    for (const it of items) {
      if (!it?.name || !it?.text) continue
      const s = await summarize(it.name, it.text)
      if (s) {
        await supa.from('guide_places').update({ description: s }).eq('name', it.name).is('description', null)
        updated++
      }
    }
    return NextResponse.json({ mode, received: items.length, updated })
  }

  return NextResponse.json({ error: 'unknown mode' }, { status: 400 })
}
