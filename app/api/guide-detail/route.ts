import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { searchWeb } from '@/lib/searchProvider'

// Szczegóły miejsca w Przewodniku (on-demand + cache). Zbiera REALNE dane:
// Google Place Details (zdjęcia, cena, godziny, www, recenzje), blogi (Brave),
// fragment poradnika (pdf_more), a DeepSeek tylko PORZĄDKUJE je w punkty
// (bez zmyślania). Część Przewodnika — usuwalne razem z całą funkcją.
export const maxDuration = 60

const supa = createClient(
  (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim(),
  (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim(),
)
const GKEY = process.env.GOOGLE_PLACES_API_KEY || ''
const FRESH_MS = 30 * 24 * 60 * 60 * 1000 // 30 dni

const PRICE_TXT = ['darmowe / bardzo tanio', 'tanio', 'średnio', 'drogo', 'bardzo drogo']

async function googleDetails(placeId: string) {
  if (!GKEY || !placeId) return null
  const fields =
    'name,price_level,website,formatted_phone_number,opening_hours,editorial_summary,rating,user_ratings_total,reviews,photos,url'
  const url =
    `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}` +
    `&language=pl&fields=${fields}&key=${GKEY}`
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const data = await res.json()
    const r = data?.result
    if (!r) return null
    const photos = Array.isArray(r.photos)
      ? r.photos.slice(0, 8).map((p: any) => p.photo_reference).filter(Boolean)
      : []
    const reviews = Array.isArray(r.reviews)
      ? r.reviews.slice(0, 3).map((rv: any) => ({
          author: String(rv.author_name || '').slice(0, 60),
          rating: rv.rating ?? null,
          when: String(rv.relative_time_description || '').slice(0, 40),
          text: String(rv.text || '').replace(/\s+/g, ' ').trim().slice(0, 320),
        })).filter((rv: any) => rv.text)
      : []
    return {
      photos,
      google: {
        price_level: typeof r.price_level === 'number' ? r.price_level : null,
        price_txt: typeof r.price_level === 'number' ? PRICE_TXT[r.price_level] || null : null,
        website: r.website || null,
        phone: r.formatted_phone_number || null,
        hours: r.opening_hours?.weekday_text || null,
        editorial: r.editorial_summary?.overview || null,
        rating: r.rating ?? null,
        total: r.user_ratings_total ?? null,
        maps_url: r.url || null,
        reviews,
      },
    }
  } catch {
    return null
  }
}

async function deepSeek(prompt: string): Promise<string> {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), 35000)
  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        max_tokens: 600,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'Jesteś redaktorem przewodnika. Odpowiadasz wyłącznie po polsku i zwracasz TYLKO poprawny JSON.' },
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

async function buildAi(ctx: {
  name: string; category: string; description: string | null; pdf_more: string | null
  editorial: string | null; price_txt: string | null; reviews: any[]; blogs: any[]
}) {
  const isTrail = ctx.category === 'trail'
  const sources: string[] = []
  if (ctx.description) sources.push(`OPIS Z PORADNIKA: ${ctx.description}`)
  if (ctx.pdf_more) sources.push(`WIĘCEJ Z PORADNIKA: ${ctx.pdf_more.slice(0, 1200)}`)
  if (ctx.editorial) sources.push(`GOOGLE (opis): ${ctx.editorial}`)
  if (ctx.price_txt) sources.push(`GOOGLE (poziom cen): ${ctx.price_txt}`)
  if (ctx.reviews?.length) sources.push(`RECENZJE GOOGLE: ${ctx.reviews.map((r) => r.text).join(' | ').slice(0, 700)}`)
  if (ctx.blogs?.length) sources.push(`BLOGI: ${ctx.blogs.map((b: any) => `${b.title} — ${b.snippet}`).join(' | ').slice(0, 800)}`)
  if (!sources.length) return {}

  const prompt =
    `Na podstawie WYŁĄCZNIE poniższych źródeł o miejscu „${ctx.name}" (kategoria: ${ctx.category}) ` +
    `przygotuj zwięzłe, praktyczne podsumowanie po polsku. NIE wymyślaj faktów — jeśli czegoś nie ma w źródłach, ustaw null.\n\n` +
    `Zwróć JSON o polach:\n` +
    `- "cena": string|null (krótko o kosztach/biletach/parkingu, jeśli wynika ze źródeł)\n` +
    (isTrail
      ? `- "czas": string|null (orientacyjny czas przejścia)\n- "trasa": string|null (długość/charakter trasy)\n- "trudnosc": string|null (łatwa/średnia/trudna)\n`
      : `- "czas": string|null (ile średnio zajmuje zwiedzanie/pobyt, jeśli wynika)\n- "trasa": null\n- "trudnosc": null\n`) +
    `- "tipy": string[] (0-5 konkretnych wskazówek ze źródeł; każda max ~140 znaków; pusta tablica jeśli brak)\n\n` +
    `ŹRÓDŁA:\n${sources.join('\n')}`

  const out = await deepSeek(prompt)
  if (!out) return {}
  try {
    const clean = out.replace(/^```json\s*|^```\s*|```$/gim, '').trim()
    const obj = JSON.parse(clean)
    const tipy = Array.isArray(obj.tipy) ? obj.tipy.filter((x: any) => typeof x === 'string' && x.trim()).slice(0, 5) : []
    return {
      cena: typeof obj.cena === 'string' ? obj.cena.slice(0, 300) : null,
      czas: typeof obj.czas === 'string' ? obj.czas.slice(0, 200) : null,
      trasa: typeof obj.trasa === 'string' ? obj.trasa.slice(0, 200) : null,
      trudnosc: typeof obj.trudnosc === 'string' ? obj.trudnosc.slice(0, 120) : null,
      tipy,
    }
  } catch {
    return {}
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id') || ''
  const force = searchParams.get('refresh') === '1'
  if (!id) return NextResponse.json({ error: 'no id' }, { status: 400 })

  const { data: place } = await supa
    .from('guide_places')
    .select('id,name,category,lat,lon,description,google_place_id,google_rating,google_total_ratings')
    .eq('id', id)
    .maybeSingle()
  if (!place) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const { data: cached } = await supa.from('guide_place_details').select('*').eq('guide_place_id', id).maybeSingle()
  const fresh = cached?.fetched_at && Date.now() - new Date(cached.fetched_at).getTime() < FRESH_MS
  if (cached && fresh && !force) {
    return NextResponse.json({ place, details: cached })
  }

  // —— pobranie świeżych danych ——
  const pdf_more = cached?.pdf_more ?? null
  const [gd, blogsRaw] = await Promise.all([
    place.google_place_id ? googleDetails(place.google_place_id) : Promise.resolve(null),
    searchWeb(`${place.name} Słowenia przewodnik`, 5),
  ])
  const blogs = (blogsRaw || [])
    .filter((b) => b.url && !/google\.|tripadvisor\./i.test(b.url))
    .slice(0, 3)
    .map((b) => ({ title: b.title.slice(0, 120), url: b.url, snippet: b.snippet.slice(0, 200) }))

  const photos = gd?.photos || cached?.photos || []
  const google = gd?.google || cached?.google || {}

  const ai = await buildAi({
    name: place.name,
    category: place.category,
    description: place.description,
    pdf_more,
    editorial: (google as any)?.editorial || null,
    price_txt: (google as any)?.price_txt || null,
    reviews: (google as any)?.reviews || [],
    blogs,
  })

  const row = {
    guide_place_id: id,
    photos,
    google,
    blogs,
    ai,
    pdf_more,
    fetched_at: new Date().toISOString(),
  }
  const { data: saved } = await supa
    .from('guide_place_details')
    .upsert(row, { onConflict: 'guide_place_id' })
    .select('*')
    .maybeSingle()

  return NextResponse.json({ place, details: saved || row })
}
