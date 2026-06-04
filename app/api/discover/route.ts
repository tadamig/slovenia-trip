import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 60

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY

// Cache (Supabase) — wyniki silnika zmieniają się wolno, więc cache'ujemy pulę.
const CACHE_TTL_MS = 12 * 60 * 60 * 1000 // 12h

// FIX4: single-flight — koalescencja równoległych identycznych zapytań (ten sam cacheKey)
// na poziomie instancji serwerless. Zimny cache + kilka osob klikających „Szukaj" naraz
// = jedno realne wykonanie zamiast N (oszczędza Google/DeepSeek i ujednolica wynik).
type DiscoverPayload = { places: DiscoverPlace[]; shops: unknown[]; baseLat: number | null; baseLon: number | null; meta: Record<string, unknown> }
const inFlightDiscover = new Map<string, Promise<DiscoverPayload>>()
const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim()
const supabaseKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim()
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null

// ——————————————————————————————————————————————
// Typy
// ——————————————————————————————————————————————
type SortMode = 'match' | 'rating' | 'distance'

type Candidate = {
  name: string
  activity: string
  area?: string
}

type DiscoverPlace = {
  name: string
  googlePlaceId: string
  lat: number
  lon: number
  googleRating?: number
  googleTotalRatings?: number
  address?: string
  subregion?: string
  country?: string
  types: string[]
  tags: string[]
  distanceFromBase: number
  priceLevel?: number
  verified: boolean
  source: 'google'
  isOpen?: boolean | null
  openingHours?: string[]   // weekday_text z Place Details (pod planer dni / mapę)
  website?: string
  recentReviewHighlights?: string[]
  curated: boolean
  matchedActivities: string[]
  score: number
  sources?: { url: string; title: string }[]
  mentionCount?: number
}

// ——————————————————————————————————————————————
// Słownik aktywności = jedyne dozwolone tagi (zgodne z UI)
// ——————————————————————————————————————————————
const KNOWN_ACTIVITIES = new Set([
  'sup', 'trekking', 'food', 'sunset', 'sightseeing', 'relax',
  'photo', 'markets', 'nightlife', 'cycling', 'van', 'tent', 'petfriendly',
])

// Destynacje (NIE usługi) — zapytania nastawione na cele podróży,
// a nie wypożyczalnie/sklepy.
const ACTIVITY_DEST_QUERIES: Record<string, string[]> = {
  sup: ['lake to swim', 'beach', 'natural swimming spot'],
  trekking: ['hiking trail', 'gorge waterfall trail', 'mountain viewpoint trail'],
  food: ['best traditional restaurant', 'top rated local restaurant'],
  sunset: ['sunset viewpoint', 'panoramic viewpoint'],
  sightseeing: ['castle', 'old town landmark', 'must see attraction'],
  relax: ['thermal spa', 'wellness retreat'],
  photo: ['scenic photo spot', 'most photogenic viewpoint'],
  markets: ['tržnica', 'farmers market', 'market hall', 'local market'],
  nightlife: ['popular bar', 'nightlife club'],
  cycling: ['scenic cycling route', 'bike path nature'],
  van: ['campsite for campervan', 'panoramic camper stop'],
  tent: ['campground nature', 'tent camping site'],
  petfriendly: ['dog friendly cafe', 'pet friendly park trail'],
}

// Konkretne typy miejsc (planer dnia, Faza 3.5) — precyzyjne zapytania textsearch.
// Pozwalają wybrać dokładnie „kawa / cukiernia / bary" zamiast szerokiej kategorii.
const POI_QUERIES: Record<string, string[]> = {
  restaurant: ['best traditional restaurant', 'top rated local restaurant'],
  cafe: ['specialty coffee shop', 'best cafe coffee'],
  bakery: ['patisserie cake shop', 'bakery dessert pastry'],
  bar: ['cocktail bar', 'popular bar pub'],
  icecream: ['gelato ice cream', 'best ice cream'],
  streetfood: ['street food spot', 'food hall street food'],
  landmark: ['historic landmark', 'old town must see attraction'],
  museum: ['museum', 'art gallery'],
  park: ['city park garden', 'nature reserve park'],
  viewpoint: ['panoramic viewpoint', 'scenic lookout'],
  water: ['lake to swim', 'beach natural swimming spot'],
  trekking: ['hiking trail', 'gorge waterfall trail'],
  markets: ['tržnica farmers market', 'market hall local market'],
  photo: ['scenic photo spot', 'most photogenic viewpoint'],
}

// Konkretny typ → szeroka aktywność (do kuracji, scoringu, tagów, logowania).
const CAT_TO_ACTIVITY: Record<string, string> = {
  restaurant: 'food', cafe: 'food', bakery: 'food', bar: 'nightlife', icecream: 'food',
  streetfood: 'food', landmark: 'sightseeing', museum: 'sightseeing', park: 'trekking',
  viewpoint: 'sunset', water: 'sup', trekking: 'trekking', markets: 'markets', photo: 'photo',
}

// Typy Google, które są usługami/sklepami — nie chcemy ich jako "atrakcji"
const EXCLUDE_TYPES = new Set([
  'car_rental', 'car_repair', 'car_dealer', 'bicycle_store', 'store',
  'clothing_store', 'shoe_store', 'electronics_store', 'hardware_store',
  'furniture_store', 'home_goods_store', 'convenience_store', 'supermarket',
  'travel_agency', 'storage', 'moving_company', 'real_estate_agency',
  'insurance_agency', 'finance', 'bank', 'atm', 'gas_station', 'parking',
  'laundry', 'gym', 'beauty_salon', 'hair_care', 'dentist', 'doctor',
  'pharmacy', 'lawyer', 'accounting', 'plumber', 'electrician',
])

// Nazwy zdradzające usługę (wypożyczalnia / sklep / wynajem)
const RENTAL_NAME_RE = /\b(rent|rents|rental|rentals|hire|wypożyczaln|outfitter|equipment|sklep|store|shop)\b/i

// ——————————————————————————————————————————————
// Sklepy / markety — NIE śmieci do wyrzucenia, tylko osobna kategoria.
// Nie pokazujemy ich userowi w głównych wynikach, ale odkładamy do
// wewnętrznego kubełka `shops` w odpowiedzi API — pod przyszłe funkcje
// (planer dnia, dodawanie sklepów do trasy).
// ——————————————————————————————————————————————
const SHOP_TYPES = new Set([
  'supermarket', 'grocery_or_supermarket', 'convenience_store',
  'shopping_mall', 'department_store',
])

// Sieci handlowe (po nazwie) — łapiemy nawet gdy Google nie da typu sklepowego.
const SHOP_CHAIN_RE = /\b(lidl|spar|interspar|hofer|mercator|tuš|tus|leclerc|aldi|kaufland|maximarket|petrol|omv|hipermarket|hypermarket)\b/i

// Prawdziwe targowiska — Google często taguje kryte hale targowe jako
// `shopping_mall`/`department_store`, a to DOKŁADNIE czego user chce przy
// "markets". Ta nazwa NADPISUJE klasyfikację sklepu (zostają w wynikach).
const MARKET_NAME_RE = /(tržnic|trznic|tržaš|trzas|sejem|bolšj|bolsj|market hall|farmers?\s*market|bazaar|bazar|pokrita)/i

// Czy to sklep/market (kandydat do kubełka `shops`, nie do głównych wyników).
function isShopPlace(types: string[], name: string): boolean {
  // Realne targowisko (po nazwie) NIGDY nie jest "sklepem" do schowania.
  if (MARKET_NAME_RE.test(name)) return false
  if (types.some((t) => SHOP_TYPES.has(t))) return true
  if (SHOP_CHAIN_RE.test(name)) return true
  return false
}

// Aktywności, dla których wypożyczalnie są typowym szumem
const GEAR_ACTIVITIES = new Set(['sup', 'trekking', 'cycling', 'van', 'tent'])

// ——————————————————————————————————————————————
// Helpers
// ——————————————————————————————————————————————
function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function googleTypesToTags(types: string[]): string[] {
  const tags: string[] = []
  const has = (v: string) => types.includes(v)
  if (has('restaurant') || has('cafe') || has('bakery') || has('food')) tags.push('food')
  if (has('bar') || has('night_club')) tags.push('nightlife')
  if (has('museum') || has('tourist_attraction') || has('church') || has('art_gallery')) tags.push('sightseeing')
  if (has('park') || has('natural_feature') || has('campground')) tags.push('trekking')
  if (has('spa')) tags.push('relax')
  return Array.from(new Set(tags))
}

// Wyciąga czytelną nazwę miejscowości z formatted_address Google
// (np. "Ljubljanica, 1000 Ljubljana, Slovenia" → "Ljubljana").
function localityFromAddress(addr: string, country: string): string | undefined {
  if (!addr) return undefined
  const parts = addr.split(',').map((s) => s.trim()).filter(Boolean)
  if (!parts.length) return undefined
  let p = parts[parts.length - 1]
  if (country && p.toLowerCase() === country.toLowerCase() && parts.length >= 2) {
    p = parts[parts.length - 2]
  }
  return p.replace(/^\d[\d\s-]*/, '').trim() || undefined
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  if (!raw) return null
  const base = raw.replace(/```json|```/gi, '').trim()
  const candidates = [base]
  const start = base.indexOf('{')
  const end = base.lastIndexOf('}')
  if (start >= 0 && end > start) candidates.push(base.slice(start, end + 1))
  for (const c of candidates) {
    const normalized = c
      .replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
      .replace(/,\s*([}\]])/g, '$1').replace(/\u0000/g, '').trim()
    try { return JSON.parse(normalized) } catch { /* spróbuj następny */ }
  }
  return null
}

// ——————————————————————————————————————————————
// Layer 1 — KURACJA (DeepSeek): konkretne nazwane destynacje
// ——————————————————————————————————————————————
function buildCurationPrompt(params: {
  baseCity: string
  country: string
  radius: number
  activities: string[]
  intensity?: string
  numPeople?: number
}): string {
  const { baseCity, country, radius, activities, intensity, numPeople } = params
  const acts = activities.length ? activities : ['sightseeing', 'food']
  const actList = acts.join(', ')
  return [
    `Jesteś ekspertem od podróży po regionie: ${country || 'Słowenia'}.`,
    `Grupa (${numPeople || 4} os., tempo: ${intensity || 'zbalansowane'}) startuje z: ${baseCity || country}.`,
    `Wypisz KONKRETNE, NAZWANE z imienia atrakcje/destynacje w promieniu ok. ${radius} km od ${baseCity || country}.`,
    `Aktywności grupy: ${actList}.`,
    '',
    'ZASADY:',
    '- Podawaj CELE PODRÓŻY, nie usługi. Np. dla "sup" → konkretne jezioro/plaża gdzie się pływa (NIE wypożyczalnia SUP).',
    '- Dla "trekking" → nazwany szlak/wąwóz/szczyt/wodospad. Dla "markets" → nazwany targ. Dla "food" → konkretna ceniona restauracja.',
    '- Tylko realne, istniejące miejsca, które łatwo znaleźć w Google Maps. Używaj oficjalnych/lokalnych nazw.',
    '- Bazuj na znanych rankingach/blogach ("top 10 szlaków", "najlepsze jeziora") — wybieraj sprawdzone, wysoko oceniane miejsca.',
    `- Dla KAŻDEJ aktywności podaj 6-8 różnych miejsc. Łącznie maksymalnie 40.`,
    '- Pole "activity" musi być dokładnie jednym z: ' + Array.from(KNOWN_ACTIVITIES).join(', ') + '.',
    '',
    'Zwróć WYŁĄCZNIE jeden obiekt JSON w formacie:',
    '{"candidates":[{"name":"oficjalna nazwa miejsca","activity":"trekking","area":"okolica/miasto"}]}',
  ].join('\n')
}

async function curate(params: {
  baseCity: string
  country: string
  radius: number
  activities: string[]
  intensity?: string
  numPeople?: number
}): Promise<Candidate[]> {
  if (!DEEPSEEK_API_KEY) return []
  const prompt = buildCurationPrompt(params)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 40000)
  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        max_tokens: 1800,
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
    const raw = asArray<any>(parsed?.candidates)
    const seen = new Set<string>()
    const out: Candidate[] = []
    for (const c of raw) {
      const name = typeof c?.name === 'string' ? c.name.trim() : ''
      const activity = typeof c?.activity === 'string' ? c.activity.trim().toLowerCase() : ''
      if (!name || !KNOWN_ACTIVITIES.has(activity)) continue
      const key = name.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ name, activity, area: typeof c?.area === 'string' ? c.area : undefined })
      if (out.length >= 40) break
    }
    return out
  } catch {
    return []
  } finally {
    clearTimeout(timeout)
  }
}

// ——————————————————————————————————————————————
// Layer 2 — WERYFIKACJA (Google Places)
// ——————————————————————————————————————————————
async function geocodeCity(city: string, country: string): Promise<{ lat: number; lon: number } | null> {
  if (!GOOGLE_API_KEY) return null
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(`${city}, ${country}`)}&key=${GOOGLE_API_KEY}`
    const res = await fetch(url)
    if (!res.ok) return null
    const data = await res.json()
    const loc = data.results?.[0]?.geometry?.location
    return loc ? { lat: loc.lat, lon: loc.lng } : null
  } catch {
    return null
  }
}

async function textSearch(query: string, lat: number, lon: number, radius: number): Promise<any[]> {
  if (!GOOGLE_API_KEY) return []
  try {
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&location=${lat},${lon}&radius=${radius * 1000}&key=${GOOGLE_API_KEY}&language=en`
    const res = await fetch(url)
    if (!res.ok) return []
    const data = await res.json()
    return data.results || []
  } catch {
    return []
  }
}

async function getPlaceDetails(placeId: string): Promise<any> {
  if (!GOOGLE_API_KEY) return {}
  try {
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=opening_hours,price_level,website,reviews,rating,user_ratings_total&key=${GOOGLE_API_KEY}&language=pl`
    const res = await fetch(url)
    if (!res.ok) return {}
    const data = await res.json()
    return data.result || {}
  } catch {
    return {}
  }
}

// Limituj równoległość, by nie zalać API
async function mapLimit<T, R>(items: T[], limit: number, fn: (_item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = []
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

function isExcludedPlace(types: string[], name: string, intendedActivity: string | null): boolean {
  // Nigdy nie wykluczaj na podstawie typów, gdy to restauracja/atrakcja itd.
  const hasExcludedType = types.some((t) => EXCLUDE_TYPES.has(t))
  if (hasExcludedType) {
    // Restauracje/atrakcje mogą współdzielić "store"/"point_of_interest" — chroń realne cele
    const isRealDest = types.some((t) =>
      ['restaurant', 'cafe', 'bar', 'tourist_attraction', 'museum', 'park',
        'natural_feature', 'campground', 'spa', 'church', 'art_gallery',
        'lodging', 'food'].includes(t))
    if (!isRealDest) return true
  }
  // Wypożyczalnie/sklepy po nazwie — odrzucaj zwłaszcza dla aktywności sprzętowych
  if (RENTAL_NAME_RE.test(name)) {
    if (!intendedActivity || GEAR_ACTIVITIES.has(intendedActivity)) return true
  }
  return false
}

// ——————————————————————————————————————————————
// Layer 3 — RANKING (ważony scoring)
// ——————————————————————————————————————————————
function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

function computeScore(p: {
  googleRating?: number
  googleTotalRatings?: number
  distanceFromBase: number
  matchedActivities: string[]
  curated: boolean
  mentionCount?: number
  radius: number
}): number {
  const ratingScore = clamp01(((p.googleRating ?? 4.3) - 4.3) / (5 - 4.3))
  const reviews = p.googleTotalRatings ?? 0
  const popularityScore = clamp01(Math.log10(reviews + 1) / Math.log10(5000))
  const proximityScore = clamp01(1 - p.distanceFromBase / Math.max(1, p.radius))
  const activityScore = p.matchedActivities.length > 0
    ? clamp01(0.6 + 0.2 * p.matchedActivities.length)
    : 0.3
  // Sygnał redakcyjny: skuratowane z blogów (Layer 0). To nasz najmocniejszy
  // wyróżnik jakości, więc dajemy mu wysoką wagę. Bazowo 0.6 za jedną wzmiankę,
  // rośnie z liczbą różnych blogów (mention_count) do 1.0 — krzywa znormalizowana
  // do ~5 wzmianek (tyle ma dziś najczęściej wspominane miejsce w bazie).
  const mentions = p.mentionCount ?? (p.curated ? 1 : 0)
  const mentionNorm = clamp01(Math.log10(mentions + 1) / Math.log10(6))
  const editorialScore = p.curated ? clamp01(0.6 + 0.4 * mentionNorm) : 0
  const score =
    0.34 * activityScore +
    0.16 * ratingScore +
    0.12 * popularityScore +
    0.12 * proximityScore +
    0.26 * editorialScore
  return Math.round(score * 1000) / 10 // 0–100, 1 miejsce po przecinku
}

function sortPlaces(list: DiscoverPlace[], sort: SortMode): DiscoverPlace[] {
  const arr = list.slice()
  if (sort === 'rating') {
    arr.sort((a, b) =>
      (b.googleRating ?? 0) - (a.googleRating ?? 0) ||
      (b.googleTotalRatings ?? 0) - (a.googleTotalRatings ?? 0))
  } else if (sort === 'distance') {
    arr.sort((a, b) => a.distanceFromBase - b.distanceFromBase)
  } else {
    arr.sort((a, b) => b.score - a.score)
  }
  return arr
}

// ——————————————————————————————————————————————
// Cache (Supabase) — klucz pomija "sort" (sortowanie aplikujemy przy odczycie)
// ——————————————————————————————————————————————
function buildCacheKey(p: { baseCity: string; country: string; radius: number; activities: string[]; categories?: string[] }): string {
  const acts = p.activities.slice().sort().join(',')
  const cats = (p.categories || []).slice().sort().join(',')
  return `discover|${p.country.toLowerCase().trim()}|${p.baseCity.toLowerCase().trim()}|r${p.radius}|${acts}${cats ? `|c:${cats}` : ''}`
}

async function readCache(key: string): Promise<{ places: DiscoverPlace[]; shops?: unknown[]; baseLat: number; baseLon: number; meta: Record<string, unknown> } | null> {
  if (!supabase) return null
  try {
    const { data } = await supabase
      .from('discover_cache')
      .select('payload, created_at')
      .eq('cache_key', key)
      .maybeSingle()
    if (!data) return null
    const age = Date.now() - new Date(data.created_at as string).getTime()
    if (age > CACHE_TTL_MS) return null
    return data.payload as any
  } catch {
    return null
  }
}

async function writeCache(key: string, payload: Record<string, unknown>): Promise<void> {
  if (!supabase) return
  try {
    await supabase
      .from('discover_cache')
      .upsert({ cache_key: key, payload, created_at: new Date().toISOString() }, { onConflict: 'cache_key' })
  } catch {
    /* cache best-effort */
  }
}

// ——————————————————————————————————————————————
// Layer 0 — BAZA WIEDZY (curated_places): miejsca wyłuskane offline z blogów,
// już zweryfikowane w Google. Czytamy publicznie (RLS: anon select).
// ——————————————————————————————————————————————
type CuratedRow = {
  google_place_id: string
  name: string
  lat: number | null
  lon: number | null
  google_rating: number | null
  google_total_ratings: number | null
  subregion: string | null
  country: string | null
  types: string[] | null
  activities: string[] | null
  sources: { url: string; title: string }[] | null
  mention_count: number | null
}

async function readCuratedPlaces(country: string, activities: string[]): Promise<CuratedRow[]> {
  if (!supabase || !country) return []
  try {
    let query = supabase
      .from('curated_places')
      .select('google_place_id, name, lat, lon, google_rating, google_total_ratings, subregion, country, types, activities, sources, mention_count')
      .ilike('country', country)
      .eq('active', true)
    if (activities.length) query = query.overlaps('activities', activities)
    const { data } = await query.limit(300)
    return (data as CuratedRow[]) || []
  } catch {
    return []
  }
}

// ——————————————————————————————————————————————
// POST
// ——————————————————————————————————————————————
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const baseCity: string = body.baseCity || ''
    const country: string = body.country || ''
    const rawActivities: string[] = asArray<string>(body.activities)
    const activities = rawActivities.filter((a) => KNOWN_ACTIVITIES.has(a))
    // Faza 3.5: konkretne typy miejsc (planer dnia). Gdy podane — sterują wyszukiwaniem.
    const rawCategories: string[] = asArray<string>(body.categories)
    const categories = rawCategories.filter((c) => POI_QUERIES[c])
    const radius: number = Math.max(10, Math.min(80, Number(body.radius) || 40))
    const sort: SortMode = ['match', 'rating', 'distance'].includes(body.sort) ? body.sort : 'match'

    if (!GOOGLE_API_KEY) return NextResponse.json({ places: [], error: 'No Google API key' })

    // Geokoduj bazę
    let lat: number | null = Number(body.baseLat) || null
    let lon: number | null = Number(body.baseLon) || null
    if (!lat || !lon) {
      const coords = await geocodeCity(baseCity, country)
      if (!coords) return NextResponse.json({ places: [], error: 'Geocode failed' })
      lat = coords.lat
      lon = coords.lon
    }

    // Gdy podano konkretne typy — aktywności (do kuracji/scoringu) wyprowadzamy z nich.
    const effActivities = categories.length
      ? Array.from(new Set(categories.map((c) => CAT_TO_ACTIVITY[c]).filter(Boolean)))
      : (activities.length ? activities : ['sightseeing', 'food'])

    // Auto-uczenie (Element 1): zaloguj realne zapytanie (fire-and-forget).
    // Termometr popularności dla crona auto-ingest. Nie blokuje krytycznej ścieżki
    // przy błędzie; logujemy też trafienia w cache, by liczyć faktyczny popyt.
    if (country && supabase) {
      try {
        await supabase.rpc('log_discover_query', {
          p_country: country.trim(),
          p_city: (baseCity || '').trim(),
          p_activities: [...effActivities].sort(),
        })
      } catch { /* log nie może psuć discover */ }
    }

    // Cache: jeśli świeży wynik dla (kraj, miasto, promień, aktywności) — zwróć,
    // re-sortując wg bieżącego wyboru (sort nie wchodzi do klucza).
    const cacheKey = buildCacheKey({ baseCity, country, radius, activities: effActivities, categories })
    const cached = await readCache(cacheKey)
    if (cached && Array.isArray(cached.places)) {
      return NextResponse.json({
        places: sortPlaces(cached.places, sort),
        shops: Array.isArray(cached.shops) ? cached.shops : [],
        baseLat: cached.baseLat ?? lat,
        baseLon: cached.baseLon ?? lon,
        meta: { ...(cached.meta || {}), sort, cached: true },
      })
    }

    // FIX4: single-flight — jeśli identyczne zapytanie już leci, doczep się do niego.
    let payloadPromise = inFlightDiscover.get(cacheKey)
    if (!payloadPromise) {
      payloadPromise = (async (): Promise<DiscoverPayload> => {
    // Layer 0 (baza wiedzy z blogów) + Layer 1 (kuracja DeepSeek) — równolegle.
    const [curatedRows, curated] = await Promise.all([
      readCuratedPlaces(country, effActivities),
      curate({
        baseCity, country, radius,
        activities: effActivities,
        intensity: body.intensity,
        numPeople: body.numPeople,
      }),
    ])

    // Layer 2: zbuduj listę zapytań textsearch
    // (a) skuratowane nazwy + (b) zapytania destynacyjne per aktywność
    type Query = { q: string; activity: string | null; curated: boolean }
    const queries: Query[] = []
    for (const c of curated) {
      queries.push({ q: `${c.name} ${c.area || ''} ${country}`.trim(), activity: c.activity, curated: true })
    }
    if (categories.length) {
      // Faza 3.5: precyzyjne zapytania per konkretny typ miejsca (kawa, bary, cukiernia…).
      for (const cat of categories) {
        const templates = POI_QUERIES[cat] || []
        for (const t of templates.slice(0, 2)) {
          queries.push({ q: `${t} near ${baseCity || country}`, activity: CAT_TO_ACTIVITY[cat] || null, curated: false })
        }
      }
    } else {
      for (const a of effActivities) {
        const templates = ACTIVITY_DEST_QUERIES[a] || []
        for (const t of templates.slice(0, 2)) {
          queries.push({ q: `${t} near ${baseCity || country}`, activity: a, curated: false })
        }
      }
    }

    // Wykonaj wyszukiwania z ograniczoną równoległością
    const searchResults = await mapLimit(queries, 6, async (query) => {
      const results = await textSearch(query.q, lat!, lon!, radius)
      return { query, results }
    })

    // Dedup po place_id; zbieraj intencję aktywności + flagę curated
    const byId = new Map<string, DiscoverPlace>()
    // Wewnętrzny kubełek sklepów/marketów — nie pokazywany userowi teraz,
    // ale zwracany w odpowiedzi pod przyszłe funkcje (planer dnia / trasy).
    const shopsById = new Map<string, {
      name: string; googlePlaceId: string; lat: number; lon: number
      googleRating?: number; googleTotalRatings?: number; address?: string
      subregion?: string; country?: string; types: string[]; distanceFromBase: number
    }>()
    // Wtórny dedup po znormalizowanej nazwie — np. rzeka/feature, którą Google
    // zwraca z RÓŻNYMI place_id z różnych zapytań (Ljubljanica), inaczej klonuje się.
    const byName = new Map<string, string>()
    const normName = (n: string) => n.toLowerCase().replace(/\s+/g, ' ').trim()
    const mergeInto = (place: DiscoverPlace, query: { activity: string | null; curated: boolean }) => {
      if (query.activity && !place.matchedActivities.includes(query.activity)) {
        place.matchedActivities.push(query.activity)
      }
      if (query.curated) place.curated = true
    }

    // Layer 0: zasiej pulę miejscami z bazy wiedzy (blogi → curated_places).
    // Są już zweryfikowane jakościowo przy ingeście; tu liczymy dystans i
    // przycinamy do promienia. Wpadają do tej samej deduplikacji po place_id.
    let curatedSeeded = 0
    for (const row of curatedRows) {
      if (!row.google_place_id || typeof row.lat !== 'number' || typeof row.lon !== 'number') continue
      const distance = Math.round(distanceKm(lat!, lon!, row.lat, row.lon))
      if (distance > radius) continue
      const rowActs = (row.activities || []).filter((a) => KNOWN_ACTIVITIES.has(a))
      const matched = rowActs.filter((a) => effActivities.includes(a))
      const tags = rowActs.length ? rowActs : ['sightseeing']
      byId.set(row.google_place_id, {
        name: row.name,
        googlePlaceId: row.google_place_id,
        lat: row.lat,
        lon: row.lon,
        googleRating: row.google_rating ?? undefined,
        googleTotalRatings: row.google_total_ratings ?? undefined,
        subregion: row.subregion || localityFromAddress('', country),
        country: row.country || country || undefined,
        types: row.types || [],
        tags,
        distanceFromBase: distance,
        verified: true,
        source: 'google',
        isOpen: null,
        curated: true,
        matchedActivities: matched.length ? matched : (rowActs[0] ? [rowActs[0]] : []),
        score: 0,
        sources: Array.isArray(row.sources) ? row.sources.map((s) => ({ url: s.url, title: s.title })) : [],
        mentionCount: row.mention_count ?? (Array.isArray(row.sources) ? row.sources.length : 0),
      })
      const nk = normName(row.name)
      if (nk) byName.set(nk, row.google_place_id)
      curatedSeeded++
    }

    for (const { query, results } of searchResults) {
      for (const r of results) {
        if (!r.place_id) continue
        const placeLat = r.geometry?.location?.lat
        const placeLon = r.geometry?.location?.lng
        if (typeof placeLat !== 'number' || typeof placeLon !== 'number') continue

        const distance = Math.round(distanceKm(lat!, lon!, placeLat, placeLon))
        if (distance > radius) continue // twardy limit promienia

        const types: string[] = r.types || []
        const name: string = r.name || ''

        // Sklep/market → kubełek `shops` (nie do głównych wyników), dane czekają
        // pod przyszłe funkcje. Łapiemy TU, przed isExcludedPlace, więc problem
        // "ratunku przez typ food" (markety niosą `food`) znika u źródła.
        if (isShopPlace(types, name)) {
          if (!shopsById.has(r.place_id)) {
            shopsById.set(r.place_id, {
              name,
              googlePlaceId: r.place_id,
              lat: placeLat,
              lon: placeLon,
              googleRating: r.rating,
              googleTotalRatings: r.user_ratings_total,
              address: r.formatted_address,
              subregion: localityFromAddress(r.formatted_address || '', country),
              country: country || undefined,
              types,
              distanceFromBase: distance,
            })
          }
          continue
        }

        if (isExcludedPlace(types, name, query.activity)) continue

        const existing = byId.get(r.place_id)
        if (existing) {
          mergeInto(existing, query)
          continue
        }

        // ten sam obiekt pod inną nazwą-place_id (rzeka, park) → scal, nie dubluj
        const nameKey = normName(name)
        const dupId = nameKey ? byName.get(nameKey) : undefined
        if (dupId) {
          const dup = byId.get(dupId)
          if (dup) {
            mergeInto(dup, query)
            continue
          }
        }

        const typeTags = googleTypesToTags(types)
        const matched: string[] = []
        if (query.activity) matched.push(query.activity)
        for (const t of typeTags) {
          if (effActivities.includes(t) && !matched.includes(t)) matched.push(t)
        }
        const tags = Array.from(new Set([...matched, ...typeTags])).filter((t) => KNOWN_ACTIVITIES.has(t))

        byId.set(r.place_id, {
          name,
          googlePlaceId: r.place_id,
          lat: placeLat,
          lon: placeLon,
          googleRating: r.rating,
          googleTotalRatings: r.user_ratings_total,
          address: r.formatted_address,
          subregion: localityFromAddress(r.formatted_address || '', country),
          country: country || undefined,
          types,
          tags: tags.length ? tags : (query.activity ? [query.activity] : ['sightseeing']),
          distanceFromBase: distance,
          priceLevel: r.price_level,
          verified: true,
          source: 'google',
          isOpen: r.opening_hours?.open_now ?? null,
          curated: query.curated,
          matchedActivities: matched,
          score: 0,
        })
        if (nameKey) byName.set(nameKey, r.place_id)
      }
    }

    // Filtr jakości
    const MIN_RATING = 4.3
    const MIN_REVIEWS = 15
    const quality = Array.from(byId.values()).filter(
      (p) =>
        typeof p.googleRating === 'number' && p.googleRating >= MIN_RATING &&
        typeof p.googleTotalRatings === 'number' && p.googleTotalRatings >= MIN_REVIEWS,
    )

    // Layer 3: scoring
    for (const p of quality) {
      p.score = computeScore({
        googleRating: p.googleRating,
        googleTotalRatings: p.googleTotalRatings,
        distanceFromBase: p.distanceFromBase,
        matchedActivities: p.matchedActivities,
        curated: p.curated,
        mentionCount: p.mentionCount,
        radius,
      })
    }

    // Domyślne sortowanie wg score (ranking puli i wybór topów do szczegółów)
    quality.sort((a, b) => b.score - a.score)

    // Pobierz szczegóły (świeże opinie, godziny, strona) dla topowych
    const top = quality.slice(0, 24)
    await mapLimit(top, 6, async (p) => {
      const details = await getPlaceDetails(p.googlePlaceId)
      if (details.opening_hours?.open_now !== undefined) p.isOpen = details.opening_hours.open_now
      if (Array.isArray(details.opening_hours?.weekday_text)) p.openingHours = details.opening_hours.weekday_text
      if (details.price_level !== undefined) p.priceLevel = details.price_level
      if (details.rating !== undefined) p.googleRating = details.rating
      if (typeof details.user_ratings_total === 'number') p.googleTotalRatings = details.user_ratings_total
      if (details.website) p.website = details.website
      if (Array.isArray(details.reviews) && details.reviews.length > 0) {
        p.recentReviewHighlights = details.reviews
          .slice()
          .sort((a: any, b: any) => (b.time || 0) - (a.time || 0))
          .slice(0, 3)
          .map((r: any) => {
            const text = String(r.text || '').replace(/\s+/g, ' ').trim().slice(0, 160)
            if (!text) return ''
            const stars = typeof r.rating === 'number' ? `⭐${r.rating} ` : ''
            const when = r.relative_time_description ? ` (${r.relative_time_description})` : ''
            return `${stars}„${text}”${when}`
          })
          .filter(Boolean)
      }
    })

    // Kubełek sklepów: najbliższe najpierw, przycięty (payload + przyszłe użycie).
    const shops = Array.from(shopsById.values())
      .sort((a, b) => a.distanceFromBase - b.distanceFromBase)
      .slice(0, 40)

    const meta = {
      curatedCount: curated.length,
      curatedSeeded,
      queriesRun: queries.length,
      rawCandidates: byId.size,
      verified: quality.length,
      shopsFound: shops.length,
      radius,
    }

    // Zapisz do cache pulę posortowaną domyślnie wg score (klucz pomija sort)
    const payload: DiscoverPayload = {
      places: sortPlaces(quality, 'match'),
      shops,
      baseLat: lat,
      baseLon: lon,
      meta,
    }
    await writeCache(cacheKey, payload)
    return payload
      })().finally(() => { inFlightDiscover.delete(cacheKey) })
      inFlightDiscover.set(cacheKey, payloadPromise)
    }

    const payload = await payloadPromise

    // Finalne sortowanie wg wyboru użytkownika (poza single-flight — sort jest per-request)
    return NextResponse.json({
      places: sortPlaces(payload.places, sort),
      shops: payload.shops,
      baseLat: payload.baseLat,
      baseLon: payload.baseLon,
      meta: { ...payload.meta, sort, cached: false },
    })
  } catch (err) {
    return NextResponse.json({ places: [], error: String(err) })
  }
}
