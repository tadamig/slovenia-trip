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
const MIN_RATING = 4.3 // próg jakości spójny z /api/discover i /api/ingest

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

// Zwraca { result, status }. status pozwala odróżnić REALNY brak miejsca
// (NOT_FOUND/ZERO_RESULTS → wygaszamy) od błędu przejściowego (zostawiamy bez zmian).
async function getPlaceDetails(placeId: string): Promise<{ result: any | null; status: string }> {
  if (!GOOGLE_API_KEY) return { result: null, status: 'NO_KEY' }
  try {
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=rating,user_ratings_total,geometry&key=${GOOGLE_API_KEY}&language=en`
    const res = await fetch(url)
    if (!res.ok) return { result: null, status: 'HTTP_ERROR' }
    const data = await res.json()
    return { result: data.result || null, status: data.status || 'UNKNOWN' }
  } catch {
    return { result: null, status: 'FETCH_ERROR' }
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

  const stats = { candidates: rows.length, refreshed: 0, failed: 0, deactivated: 0, reactivated: 0 }

  await mapLimit(rows, CONCURRENCY, async (row) => {
    const { result: details, status } = await getPlaceDetails(row.google_place_id)
    const patch: Record<string, unknown> = { last_refreshed: new Date().toISOString() }

    // Miejsce realnie zniknęło z Google → wygaś (nieniszczące, flaga active=false).
    if (status === 'NOT_FOUND' || status === 'ZERO_RESULTS') {
      patch.active = false
      const { error: upErr } = await supabaseAdmin!
        .from('curated_places').update(patch).eq('google_place_id', row.google_place_id)
      if (upErr) stats.failed++
      else { stats.refreshed++; stats.deactivated++ }
      return
    }

    // Błąd przejściowy (HTTP/fetch/brak result) → nie ruszaj flagi.
    if (!details) { stats.failed++; return }

    if (typeof details.rating === 'number') patch.google_rating = details.rating
    if (typeof details.user_ratings_total === 'number') patch.google_total_ratings = details.user_ratings_total
    const loc = details.geometry?.location
    if (loc && typeof loc.lat === 'number' && typeof loc.lng === 'number') {
      patch.lat = loc.lat
      patch.lon = loc.lng
    }

    // Auto-weryfikacja jakości: spadek poniżej progu → wygaś; powrót powyżej → przywróć.
    let toggled: 'off' | 'on' | null = null
    if (typeof details.rating === 'number') {
      if (details.rating < MIN_RATING) { patch.active = false; toggled = 'off' }
      else { patch.active = true; toggled = 'on' }
    }

    const { error: upErr } = await supabaseAdmin!
      .from('curated_places').update(patch).eq('google_place_id', row.google_place_id)
    if (upErr) { stats.failed++; return }
    stats.refreshed++
    if (toggled === 'off') stats.deactivated++
    else if (toggled === 'on') stats.reactivated++
  })

  return NextResponse.json({ ok: true, stats })
}
