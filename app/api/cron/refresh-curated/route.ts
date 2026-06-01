import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 60

// ——————————————————————————————————————————————
// /api/cron/refresh-curated — odświeża pola Google w curated_places.
//
// Po co: ToS Google pozwala trzymać lat/lon tylko do 30 dni; oceny/liczba
// opinii też się starzeją. Cron odświeża najstarsze rekordy partiami,
// utrzymując bazę w zgodzie z ToS i aktualną.
//
// Trigger: Vercel Cron (GET, codziennie — patrz vercel.json). Vercel dodaje
// nagłówek Authorization: Bearer ${CRON_SECRET}. Akceptujemy też INGEST_SECRET
// do ręcznego wywołania.
// ——————————————————————————————————————————————

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY
const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim()
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const CRON_SECRET = (process.env.CRON_SECRET || '').trim()
const INGEST_SECRET = (process.env.INGEST_SECRET || '').trim()

const supabaseAdmin =
  SUPABASE_URL && SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
    : null

const REFRESH_AFTER_DAYS = 25 // < 30 (limit Google dla lat/lon)
const BATCH = 40
const CONCURRENCY = 6

async function mapLimit<T, R>(items: T[], limit: number, fn: (_item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let i = 0
  async function worker() {
    while (i < items.length) {
      const idx = i++
      results[idx] = await fn(items[idx])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

async function getPlaceDetails(placeId: string): Promise<any | null> {
  if (!GOOGLE_API_KEY) return null
  try {
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=rating,user_ratings_total,geometry&key=${GOOGLE_API_KEY}&language=en`
    const res = await fetch(url)
    if (!res.ok) return null
    const data = await res.json()
    return data.result || null
  } catch {
    return null
  }
}

function authorized(request: NextRequest): boolean {
  const bearer = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (CRON_SECRET && bearer === CRON_SECRET) return true
  if (INGEST_SECRET && bearer === INGEST_SECRET) return true
  return false
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!supabaseAdmin) return NextResponse.json({ error: 'No service role key' }, { status: 500 })
  if (!GOOGLE_API_KEY) return NextResponse.json({ error: 'No Google API key' }, { status: 500 })

  const cutoff = new Date(Date.now() - REFRESH_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString()

  // Najstarsze najpierw; NULL last_refreshed traktujemy jako wymagające odświeżenia.
  const { data, error } = await supabaseAdmin
    .from('curated_places')
    .select('google_place_id, last_refreshed')
    .or(`last_refreshed.is.null,last_refreshed.lt.${cutoff}`)
    .order('last_refreshed', { ascending: true, nullsFirst: true })
    .limit(BATCH)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const rows = data || []

  const stats = { candidates: rows.length, refreshed: 0, failed: 0 }

  await mapLimit(rows, CONCURRENCY, async (row) => {
    const details = await getPlaceDetails(row.google_place_id)
    if (!details) { stats.failed++; return }
    const patch: Record<string, unknown> = { last_refreshed: new Date().toISOString() }
    if (typeof details.rating === 'number') patch.google_rating = details.rating
    if (typeof details.user_ratings_total === 'number') patch.google_total_ratings = details.user_ratings_total
    const loc = details.geometry?.location
    if (loc && typeof loc.lat === 'number' && typeof loc.lng === 'number') {
      patch.lat = loc.lat
      patch.lon = loc.lng
    }
    const { error: upErr } = await supabaseAdmin!
      .from('curated_places')
      .update(patch)
      .eq('google_place_id', row.google_place_id)
    if (upErr) stats.failed++
    else stats.refreshed++
  })

  return NextResponse.json({ ok: true, stats })
}
