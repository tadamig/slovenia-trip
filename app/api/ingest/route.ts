import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { searchWeb, isSearchConfigured } from '@/lib/searchProvider'

export const maxDuration = 60

// ——————————————————————————————————————————————
// /api/ingest — offline pipeline budujący bazę wiedzy `curated_places`.
//
// Przepływ dla każdej pary (miasto, aktywność):
//   1. searchWeb → URL-e artykułów blogowych ("best SUP lakes near Bled")
//   2. fetch HTML (robots.txt + throttle) → czysty tekst
//   3. DeepSeek → ekstrakcja NAZW miejsc (tylko fakty, nie proza bloga)
//   4. Google Places → place_id (klucz kanoniczny) + filtr jakości
//   5. upsert curated_places: mention_count, sources (dedup po url),
//      odświeżenie pól Google + last_refreshed
//
// Bezpieczeństwo: chroniony INGEST_SECRET; zapis kluczem service_role
// (anon nie ma policy zapisu — patrz migracja create_curated_places).
//
// Prawo: zapisujemy WYŁĄCZNIE fakty (nazwa miejsca) + link do źródła.
// Nigdy prozy/opisów bloga. Pomijamy duże agregatory. Respektujemy robots.txt.
// ——————————————————————————————————————————————

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY
const INGEST_SECRET = (process.env.INGEST_SECRET || '').trim()
const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim()
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

const supabaseAdmin =
  SUPABASE_URL && SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
    : null

// ——— Whitelist aktywności = jedyne dozwolone tagi (zgodne z UI / discover) ———
const KNOWN_ACTIVITIES = new Set([
  'sup', 'trekking', 'food', 'sunset', 'sightseeing', 'relax',
  'photo', 'markets', 'nightlife', 'cycling', 'van', 'tent',
])

// Szablony zapytań blogowych per aktywność (cele podróży, nie usługi)
const ACTIVITY_QUERY_TERMS: Record<string, string[]> = {
  sup: ['best lakes for SUP paddleboarding', 'best swimming spots'],
  trekking: ['best hiking trails', 'most beautiful gorges and waterfalls'],
  food: ['best traditional restaurants', 'top local food spots'],
  sunset: ['best sunset viewpoints'],
  sightseeing: ['top attractions and landmarks', 'must see places'],
  relax: ['best thermal spas and wellness'],
  photo: ['most photogenic spots'],
  markets: ['best local and farmers markets'],
  nightlife: ['best bars and nightlife'],
  cycling: ['best cycling routes'],
  van: ['best campervan stops and campsites'],
  tent: ['best campgrounds for tents'],
}

// Duże agregatory / serwisy z prawami do bazy danych — NIE scrape'ujemy
const EXCLUDED_DOMAINS = [
  'tripadvisor.', 'lonelyplanet.', 'booking.', 'expedia.', 'yelp.',
  'wikipedia.', 'wikivoyage.', 'getyourguide.', 'viator.', 'airbnb.',
  'reddit.', 'youtube.', 'facebook.', 'instagram.', 'pinterest.',
  'google.', 'maps.', 'tiktok.', 'x.com', 'twitter.',
]

// Filtr jakości (spójny z /api/discover)
const MIN_RATING = 4.3
const MIN_REVIEWS = 15

// Limity (utrzymują pojedynczy request w budżecie ~60s)
const BLOG_RESULTS_PER_QUERY = 5
const MAX_PAGES_PER_ACTIVITY = 4
const MAX_NAMES_PER_PAGE = 12
const FETCH_TIMEOUT_MS = 8000
const TIME_BUDGET_MS = 52000

// ——————————————————————————————————————————————
// Helpers
// ——————————————————————————————————————————————
function hostOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase() } catch { return '' }
}

function isExcludedDomain(url: string): boolean {
  const h = hostOf(url)
  return !h || EXCLUDED_DOMAINS.some((d) => h.includes(d))
}

async function fetchWithTimeout(url: string, ms: number, init?: RequestInit): Promise<Response | null> {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), ms)
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { 'User-Agent': 'SloveniaTripPlanner/1.0 (+ingest; respects robots.txt)', ...(init?.headers || {}) },
    })
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

// Minimalny, konserwatywny parser robots.txt: blokuj, jeśli dla User-agent: *
// istnieje pasujący Disallow obejmujący ścieżkę. Brak/awaria robots = dozwolone.
async function robotsAllows(url: string): Promise<boolean> {
  try {
    const u = new URL(url)
    const res = await fetchWithTimeout(`${u.origin}/robots.txt`, 4000)
    if (!res || !res.ok) return true
    const txt = await res.text()
    const lines = txt.split('\n').map((l) => l.replace(/#.*$/, '').trim())
    let appliesToAll = false
    const disallows: string[] = []
    for (const line of lines) {
      const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/)
      if (!m) continue
      const field = m[1].toLowerCase()
      const value = m[2].trim()
      if (field === 'user-agent') {
        appliesToAll = value === '*'
      } else if (field === 'disallow' && appliesToAll) {
        if (value) disallows.push(value)
      }
    }
    const path = u.pathname || '/'
    return !disallows.some((d) => path.startsWith(d))
  } catch {
    return true
  }
}

// Pobierz stronę i zredukuj do czystego tekstu (limit długości).
async function fetchPageText(url: string): Promise<string> {
  const res = await fetchWithTimeout(url, FETCH_TIMEOUT_MS)
  if (!res || !res.ok) return ''
  const ct = res.headers.get('content-type') || ''
  if (!ct.includes('text/html') && !ct.includes('text/plain')) return ''
  const html = await res.text()
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#?\w+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.slice(0, 12000)
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  if (!raw) return null
  const base = raw.replace(/```json|```/gi, '').trim()
  const start = base.indexOf('{')
  const end = base.lastIndexOf('}')
  const candidate = start >= 0 && end > start ? base.slice(start, end + 1) : base
  try {
    return JSON.parse(
      candidate.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/,\s*([}\]])/g, '$1'),
    )
  } catch {
    return null
  }
}

// DeepSeek: wyłuskaj NAZWY miejsc z tekstu artykułu (tylko fakty).
async function extractPlaceNames(text: string, activity: string, city: string, country: string): Promise<string[]> {
  if (!DEEPSEEK_API_KEY || !text) return []
  const prompt = [
    `Z poniższego tekstu artykułu podróżniczego wypisz KONKRETNE, NAZWANE z imienia miejsca/atrakcje`,
    `związane z aktywnością "${activity}" w okolicy: ${city || country}.`,
    'ZASADY:',
    '- Tylko realne, istniejące miejsca do odwiedzenia (cele podróży), nie usługi/wypożyczalnie/sklepy.',
    '- Tylko nazwy własne (np. "Lake Bled", "Vintgar Gorge"). Bez opisów, bez zdań z artykułu.',
    '- Pomijaj nazwy ogólne ("a lake", "the mountains") i nazwy miast jako całości.',
    '- Maksymalnie 15 najtrafniejszych.',
    'Zwróć WYŁĄCZNIE JSON: {"places":["Nazwa 1","Nazwa 2"]}',
    '',
    'TEKST:',
    text.slice(0, 9000),
  ].join('\n')
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), 30000)
  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DEEPSEEK_API_KEY}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        max_tokens: 600,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'Zawsze zwracasz tylko jeden poprawny obiekt JSON.' },
          { role: 'user', content: prompt },
        ],
      }),
      signal: controller.signal,
    })
    if (!res.ok) return []
    const data = await res.json()
    const parsed = parseJsonObject(data.choices?.[0]?.message?.content || '{}')
    const arr = Array.isArray(parsed?.places) ? (parsed!.places as unknown[]) : []
    const out: string[] = []
    const seen = new Set<string>()
    for (const v of arr) {
      const name = typeof v === 'string' ? v.trim() : ''
      if (name.length < 3 || name.length > 80) continue
      const key = name.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(name)
      if (out.length >= MAX_NAMES_PER_PAGE) break
    }
    return out
  } catch {
    return []
  } finally {
    clearTimeout(t)
  }
}

async function geocodeCity(city: string, country: string): Promise<{ lat: number; lon: number } | null> {
  if (!GOOGLE_API_KEY) return null
  const res = await fetchWithTimeout(
    `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(`${city}, ${country}`)}&key=${GOOGLE_API_KEY}`,
    6000,
  )
  if (!res || !res.ok) return null
  const data = await res.json()
  const loc = data.results?.[0]?.geometry?.location
  return loc ? { lat: loc.lat, lon: loc.lng } : null
}

function localityFromAddress(addr: string, country: string): string | undefined {
  if (!addr) return undefined
  const parts = addr.split(',').map((s) => s.trim()).filter(Boolean)
  if (!parts.length) return undefined
  let p = parts[parts.length - 1]
  if (country && p.toLowerCase() === country.toLowerCase() && parts.length >= 2) p = parts[parts.length - 2]
  return p.replace(/^\d[\d\s-]*/, '').trim() || undefined
}

type ResolvedPlace = {
  placeId: string
  name: string
  lat: number
  lon: number
  rating: number
  reviews: number
  types: string[]
  subregion?: string
}

// Google Places: rozwiąż nazwę → place_id + dane jakościowe.
async function resolvePlace(
  name: string,
  city: string,
  country: string,
  lat: number,
  lon: number,
): Promise<ResolvedPlace | null> {
  if (!GOOGLE_API_KEY) return null
  const query = `${name} ${city || ''} ${country}`.trim()
  const res = await fetchWithTimeout(
    `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&location=${lat},${lon}&radius=60000&key=${GOOGLE_API_KEY}&language=en`,
    8000,
  )
  if (!res || !res.ok) return null
  const data = await res.json()
  const r = (data.results || [])[0]
  if (!r?.place_id) return null
  const rating = typeof r.rating === 'number' ? r.rating : 0
  const reviews = typeof r.user_ratings_total === 'number' ? r.user_ratings_total : 0
  if (rating < MIN_RATING || reviews < MIN_REVIEWS) return null
  const placeLat = r.geometry?.location?.lat
  const placeLon = r.geometry?.location?.lng
  if (typeof placeLat !== 'number' || typeof placeLon !== 'number') return null
  return {
    placeId: r.place_id,
    name: r.name || name,
    lat: placeLat,
    lon: placeLon,
    rating,
    reviews,
    types: r.types || [],
    subregion: localityFromAddress(r.formatted_address || '', country),
  }
}

type SourceRef = { url: string; title: string; rank?: number }

// Upsert do curated_places: scal źródła (dedup po url), policz mention_count,
// dołącz aktywność, odśwież pola Google.
async function upsertCurated(
  resolved: ResolvedPlace,
  activity: string,
  country: string,
  source: SourceRef,
): Promise<'inserted' | 'updated' | 'error'> {
  if (!supabaseAdmin) return 'error'
  try {
    const { data: existing } = await supabaseAdmin
      .from('curated_places')
      .select('sources, activities')
      .eq('google_place_id', resolved.placeId)
      .maybeSingle()

    const sources: SourceRef[] = Array.isArray(existing?.sources) ? (existing!.sources as SourceRef[]) : []
    const activities: string[] = Array.isArray(existing?.activities) ? (existing!.activities as string[]) : []

    const srcExists = sources.some((s) => (s.url || '').toLowerCase() === source.url.toLowerCase())
    const nextSources = srcExists ? sources : [...sources, source]
    const nextActivities = activities.includes(activity) ? activities : [...activities, activity]

    const row = {
      google_place_id: resolved.placeId,
      name: resolved.name,
      lat: resolved.lat,
      lon: resolved.lon,
      google_rating: resolved.rating,
      google_total_ratings: resolved.reviews,
      subregion: resolved.subregion || null,
      country: country || null,
      types: resolved.types,
      activities: nextActivities.filter((a) => KNOWN_ACTIVITIES.has(a)),
      sources: nextSources,
      mention_count: nextSources.length,
      last_refreshed: new Date().toISOString(),
    }

    const { error } = await supabaseAdmin
      .from('curated_places')
      .upsert(row, { onConflict: 'google_place_id' })
    if (error) return 'error'
    return existing ? 'updated' : 'inserted'
  } catch {
    return 'error'
  }
}

// ——————————————————————————————————————————————
// POST
// ——————————————————————————————————————————————
export async function POST(request: NextRequest) {
  // Auth
  const auth = request.headers.get('authorization') || ''
  const bearer = auth.replace(/^Bearer\s+/i, '').trim()
  let body: any = {}
  try { body = await request.json() } catch { /* puste ciało dozwolone */ }
  const provided = bearer || String(body.secret || '')
  if (!INGEST_SECRET || provided !== INGEST_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!supabaseAdmin) return NextResponse.json({ error: 'No service role key' }, { status: 500 })
  if (!GOOGLE_API_KEY) return NextResponse.json({ error: 'No Google API key' }, { status: 500 })
  if (!isSearchConfigured()) return NextResponse.json({ error: 'Search provider not configured' }, { status: 500 })

  // Seeds: [{ country, city, activities: [] }]
  const seeds: Array<{ country: string; city: string; activities: string[] }> = Array.isArray(body.seeds)
    ? body.seeds
    : []
  if (!seeds.length) return NextResponse.json({ error: 'No seeds provided' }, { status: 400 })

  const started = Date.now()
  const timeLeft = () => TIME_BUDGET_MS - (Date.now() - started)

  const stats = {
    seedsProcessed: 0,
    blogsFetched: 0,
    namesExtracted: 0,
    resolved: 0,
    inserted: 0,
    updated: 0,
    skippedQuality: 0,
    errors: 0,
  }
  const log: string[] = []

  outer: for (const seed of seeds) {
    const country = String(seed.country || '').trim()
    const city = String(seed.city || '').trim()
    const acts = (Array.isArray(seed.activities) ? seed.activities : []).filter((a) => KNOWN_ACTIVITIES.has(a))
    if (!country || !acts.length) continue

    const coords = await geocodeCity(city, country)
    if (!coords) { log.push(`geocode failed: ${city}, ${country}`); continue }

    for (const activity of acts) {
      if (timeLeft() < 6000) { log.push('time budget reached'); break outer }
      const terms = ACTIVITY_QUERY_TERMS[activity] || []
      // Zbierz URL-e blogów z kilku zapytań
      const urls: SourceRef[] = []
      const seenUrls = new Set<string>()
      for (const term of terms) {
        const q = `${term} near ${city || country} ${country} blog`
        const results = await searchWeb(q, BLOG_RESULTS_PER_QUERY)
        for (let i = 0; i < results.length; i++) {
          const r = results[i]
          if (isExcludedDomain(r.url)) continue
          const key = r.url.toLowerCase()
          if (seenUrls.has(key)) continue
          seenUrls.add(key)
          urls.push({ url: r.url, title: r.title, rank: i + 1 })
        }
      }

      let pages = 0
      for (const src of urls) {
        if (pages >= MAX_PAGES_PER_ACTIVITY) break
        if (timeLeft() < 6000) { log.push('time budget reached'); break outer }
        if (!(await robotsAllows(src.url))) { log.push(`robots blocked: ${src.url}`); continue }
        const text = await fetchPageText(src.url)
        if (!text) continue
        pages++
        stats.blogsFetched++

        const names = await extractPlaceNames(text, activity, city, country)
        stats.namesExtracted += names.length

        for (const name of names) {
          if (timeLeft() < 4000) { log.push('time budget reached'); break outer }
          const resolved = await resolvePlace(name, city, country, coords.lat, coords.lon)
          if (!resolved) { stats.skippedQuality++; continue }
          stats.resolved++
          const result = await upsertCurated(resolved, activity, country, src)
          if (result === 'inserted') stats.inserted++
          else if (result === 'updated') stats.updated++
          else stats.errors++
        }
      }
    }
    stats.seedsProcessed++
  }

  return NextResponse.json({ ok: true, stats, log, ms: Date.now() - started })
}
