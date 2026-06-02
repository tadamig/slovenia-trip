import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 60

// ——————————————————————————————————————————————
// /api/cron/auto-ingest — auto-uczenie bazy wiedzy (Element 2).
//
// Idea: baza ma rosnąć tam, gdzie ludzie REALNIE szukają. /api/discover loguje
// każde zapytanie do discover_queries (miasto + aktywności + licznik trafień).
// Ten cron bierze najpopularniejsze, świeże kombinacje, sprawdza czy są słabo
// pokryte w curated_places i dla pierwszej niedostatecznie pokrytej odpala
// pełny pipeline /api/ingest (self-fetch z INGEST_SECRET).
//
// Bezpiecznik kosztów: 1 seed na przebieg (ingest sam zżera ~50s budżetu).
// Trigger: Vercel Cron (GET, codziennie — patrz vercel.json) albo ręcznie
// z nagłówkiem Authorization: Bearer ${CRON_SECRET|INGEST_SECRET}.
// ——————————————————————————————————————————————

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim()
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const CRON_SECRET = (process.env.CRON_SECRET || '').trim()
const INGEST_SECRET = (process.env.INGEST_SECRET || '').trim()

const supabaseAdmin =
  SUPABASE_URL && SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
    : null

// Ile świeżych kandydatów rozważyć, próg pokrycia (≥ = uznajemy za pokryte),
// oraz horyzont „świeżości" popytu.
const CANDIDATES = 25
const COVERAGE_THRESHOLD = 10
const DEMAND_WINDOW_DAYS = 60

type QueryRow = { country: string; city: string; activities: string[]; hits: number }

function authorized(request: NextRequest): boolean {
  const bearer = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (CRON_SECRET && bearer === CRON_SECRET) return true
  if (INGEST_SECRET && bearer === INGEST_SECRET) return true
  return false
}

// Ilu aktywnych, pasujących wpisów mamy już dla danej kombinacji (proxy pokrycia).
async function coverage(row: QueryRow): Promise<number> {
  if (!supabaseAdmin) return Number.MAX_SAFE_INTEGER
  let q = supabaseAdmin
    .from('curated_places')
    .select('*', { count: 'exact', head: true })
    .ilike('country', row.country)
    .eq('active', true)
  if (row.activities.length) q = q.overlaps('activities', row.activities)
  if (row.city) q = q.ilike('subregion', `%${row.city}%`)
  const { count, error } = await q
  if (error) return Number.MAX_SAFE_INTEGER // przy błędzie nie ingestuj na ślepo
  return count ?? 0
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!supabaseAdmin) return NextResponse.json({ error: 'No service role key' }, { status: 500 })
  if (!INGEST_SECRET) return NextResponse.json({ error: 'No ingest secret' }, { status: 500 })

  const cutoff = new Date(Date.now() - DEMAND_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabaseAdmin
    .from('discover_queries')
    .select('country, city, activities, hits')
    .gte('last_seen', cutoff)
    .order('hits', { ascending: false })
    .limit(CANDIDATES)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const rows = (data as QueryRow[]) || []

  // Znajdź pierwszą (najpopularniejszą) niedostatecznie pokrytą kombinację.
  let picked: QueryRow | null = null
  let pickedCoverage = -1
  for (const row of rows) {
    if (!row.country) continue
    const cov = await coverage(row)
    if (cov < COVERAGE_THRESHOLD) {
      picked = row
      pickedCoverage = cov
      break
    }
  }

  if (!picked) {
    return NextResponse.json({ ok: true, picked: null, candidates: rows.length, note: 'popyt pokryty' })
  }

  // Self-fetch pełnego pipeline'u ingestu dla wybranego seeda.
  const ingestUrl = new URL('/api/ingest', request.url).toString()
  let ingest: unknown = null
  try {
    const res = await fetch(ingestUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${INGEST_SECRET}` },
      body: JSON.stringify({
        seeds: [{ country: picked.country, city: picked.city, activities: picked.activities }],
      }),
    })
    ingest = await res.json()
  } catch (e) {
    return NextResponse.json({ ok: false, picked, error: 'ingest self-fetch failed' }, { status: 502 })
  }

  return NextResponse.json({
    ok: true,
    picked: { ...picked, coverageBefore: pickedCoverage },
    candidates: rows.length,
    ingest,
  })
}
