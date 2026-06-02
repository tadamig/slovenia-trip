import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 60

type SearchMode = 'standard' | 'research'

type GooglePlace = {
  name: string
  googlePlaceId?: string
  tags?: string[]
  [key: string]: unknown
}

const REGION_TO_COUNTRY: Record<string, string> = {
  slovenia: 'Slovenia',
  budapest: 'Hungary',
  croatia: 'Croatia',
  austria: 'Austria',
  italy: 'Italy',
  czechia: 'Czech Republic',
  poland: 'Poland',
  germany: 'Germany',
  france: 'France',
  spain: 'Spain',
}

const CHUNK_SIZE = 5
// Górny bufor bezpieczeństwa — liczba wzbogacanych miejsc skaluje się z wejściem,
// ale nigdy nie przekroczy tej wartości (chroni przed runaway, gdyby góra potoku
// zwróciła setki miejsc). Frontend i tak podaje ~40.
const MAX_ENRICH_PLACES = 60
// Ile chunków DeepSeek leci równolegle. TO decyduje o obciążeniu, nie liczba miejsc.
// Dzięki temu wydajność jest stała niezależnie od liczby wzbogacanych miejsc.
const MAX_CONCURRENT_CHUNKS = 6

// Przetwarza elementy z ograniczoną współbieżnością (max `limit` równolegle).
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (_item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await fn(items[index])
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker())
  await Promise.all(workers)
  return results
}

// Jedyne tagi, których używa UI (słownik aktywności). Wszystko spoza tej listy
// (np. wymyślone przez AI "bar", "góry", "bistro") jest odrzucane.
const KNOWN_TAGS = new Set([
  'sup', 'trekking', 'food', 'sunset', 'sightseeing', 'relax',
  'photo', 'markets', 'nightlife', 'cycling', 'van', 'tent', 'petfriendly',
])

function whitelistTags(...sources: unknown[]): string[] {
  const merged = sources.flatMap((s) => asArray<string>(s))
  const known = merged.filter((t) => typeof t === 'string' && KNOWN_TAGS.has(t))
  return Array.from(new Set(known))
}

const transportLabels: Record<string, string> = {
  van: 'van/kamper',
  own_car: 'wlasny samochod',
  rental: 'wynajem auta',
  motorcycle: 'motocykl',
}

const accommodationLabels: Record<string, string> = {
  tent: 'namiot/camping',
  van: 'van/kamper',
  airbnb: 'Airbnb/domki',
  hotel: 'hotel/hostel',
}

const intensityLabels: Record<string, string> = {
  slow: 'spokojne tempo',
  balanced: 'zbalansowane',
  intense: 'intensywne',
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function asString(value: unknown, fallback = 'brak danych'): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  if (!raw) return null

  const candidates: string[] = []
  const base = raw.replace(/```json|```/gi, '').trim()
  candidates.push(base)

  const start = base.indexOf('{')
  const end = base.lastIndexOf('}')
  if (start >= 0 && end > start) {
    candidates.push(base.slice(start, end + 1))
  }

  for (const candidate of candidates) {
    const normalized = candidate
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/,\s*([}\]])/g, '$1')
      .replace(/\u0000/g, '')
      .trim()
    try {
      const parsed = JSON.parse(normalized)
      return parsed && typeof parsed === 'object' ? parsed : null
    } catch {}
  }

  return null
}

function normalizeMode(value: unknown): SearchMode {
  return value === 'research' ? 'research' : 'standard'
}

function buildProfileLines(params: {
  numPeople?: number
  transport?: string
  accommodation?: string
  intensity?: string
  activities: string[]
  tripDays?: number | null
  baseCity: string
  country: string
}) {
  const {
    numPeople,
    transport,
    accommodation,
    intensity,
    activities,
    tripDays,
    baseCity,
    country,
  } = params

  const daysInfo = tripDays ? `${tripDays} dni` : 'nieznana liczba dni'

  return [
    `- Liczba osob: ${numPeople || 4}`,
    `- Transport: ${transportLabels[transport || ''] || transport || 'samochod'}`,
    `- Nocleg: ${accommodationLabels[accommodation || ''] || accommodation || 'rozny'}`,
    `- Tempo: ${intensityLabels[intensity || ''] || intensity || 'zbalansowane'}`,
    `- Aktywnosci: ${activities.join(', ') || 'ogolne zwiedzanie'}`,
    `- Czas trwania: ${daysInfo}`,
    `- Miasto bazowe: ${baseCity}, ${country}`,
  ].join('\n')
}

function buildGoogleOnlyPrompt(params: {
  searchMode: SearchMode
  profileLines: string
  googlePlaces: GooglePlace[]
}) {
  const { searchMode, profileLines, googlePlaces } = params
  const styleNote =
    searchMode === 'research'
      ? 'Tryb RESEARCH: szukaj mniej oczywistych plusow miejsca, ale bez wymyslania danych.'
      : 'Tryb STANDARD: skup sie na praktycznym opisie i dopasowaniu dla grupy.'

  const googleLines = googlePlaces
    .map(
      (p, i) =>
        `[G${i + 1}] ${p.name} | ${asString(p.address, '')} | typy: ${asArray<string>(p.types).slice(0, 4).join(', ')}`,
    )
    .join('\n')

  return `Jestes ekspertem od podrozy. Odpowiadasz tylko poprawnym JSON-em.
${styleNote}

PROFIL EKIPY:
${profileLines}

Wzbogac tylko miejsca z Google:
${googleLines}

WYMAGANIA:
- Dla kazdego miejsca zwroc informacje "dla calej ekipy".
- Gdy nie masz danych dla pola, wpisz "brak danych".
- Pisz zwiezle: max 1 zdanie na pole (description max 1-2 krotkie zdania).

Zwroc obiekt JSON:
{
  "enriched": [
    {
      "googleIndex": 0,
      "description": "1-2 krotkie zdania",
      "whyThisGroup": "1 zdanie: dlaczego pasuje calej ekipie",
      "groupFitNote": "krotka etykieta dopasowania grupowego",
      "bestTime": "krotko: najlepsza pora dnia/sezon albo brak danych",
      "visitTips": "krotko: praktyczna wskazowka albo brak danych",
      "reviewSummary": "1 zdanie podsumowania opinii",
      "tags": ["food"],
      "estimatedCost": "free|cheap|moderate|expensive|brak danych",
      "sourceCount": 0,
      "sentiment": "pozytywny|neutralny|mieszany|brak danych",
      "authenticityNote": "krotka notatka lub brak danych"
    }
  ]
}`
}

async function callDeepSeek(prompt: string, maxTokens: number) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 45000)

  try {
    return await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'Zawsze zwracasz tylko jeden poprawny obiekt JSON. Wszystkie opisy pisz po polsku.',
        },
        { role: 'user', content: prompt },
      ],
    }),
      signal: controller.signal,
  })
  } finally {
    clearTimeout(timeout)
  }
}

async function callAndParse(
  prompt: string,
  maxTokens: number,
): Promise<{ parsed: Record<string, unknown> | null; status: number }> {
  const res = await callDeepSeek(prompt, maxTokens)
  if (!res.ok) return { parsed: null, status: res.status }
  const data = await res.json()
  const rawText = data.choices?.[0]?.message?.content || '{}'
  return { parsed: parseJsonObject(rawText), status: res.status }
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

function rawGoogleFallback(places: GooglePlace[]) {
  return places.map((p) => ({
    ...p,
    description: asString(p.description, 'Google zwrocil miejsce, ale AI nie wygenerowalo opisu.'),
    whyThisGroup: 'Google zwrocil miejsce, ale AI nie wygenerowalo dopasowania.',
    groupFitNote: 'AI: brak odpowiedzi',
    bestTime: 'brak danych',
    visitTips: 'brak danych',
    reviewSummary: 'brak danych',
    recentReviewHighlights: asArray<string>(p.recentReviewHighlights).slice(0, 3),
    tags: whitelistTags(p.tags),
    estimatedCost: 'brak danych',
    sourceCount: 0,
    sentiment: 'brak danych',
    authenticityNote: 'brak danych',
  }))
}

async function enrichGoogleChunk(params: {
  searchMode: SearchMode
  profileLines: string
  chunk: GooglePlace[]
}): Promise<{ enriched: any[]; parseOk: boolean; status: number }> {
  const { searchMode, profileLines, chunk } = params
  const prompt = buildGoogleOnlyPrompt({ searchMode, profileLines, googlePlaces: chunk })

  let { parsed, status } = await callAndParse(prompt, 2400)
  // One lightweight retry only for this chunk if it failed to parse.
  if (!parsed) {
    const retry = await callAndParse(
      `${prompt}\n\nPOPRAWKA: odpowiedz musi byc jednym obiektem JSON bez markdown i bez dodatkowego tekstu.`,
      2400,
    )
    parsed = retry.parsed
    status = retry.status
  }

  if (!parsed) {
    return { enriched: rawGoogleFallback(chunk), parseOk: false, status }
  }

  const enriched = normalizeEnrichedResult({ parsed, googlePlaces: chunk })
  if (enriched.length === 0) {
    return { enriched: rawGoogleFallback(chunk), parseOk: false, status }
  }
  return { enriched, parseOk: true, status }
}

function normalizeEnrichedResult(params: {
  parsed: Record<string, unknown>
  googlePlaces: GooglePlace[]
}) {
  const { parsed, googlePlaces } = params
  const enrichedRaw = asArray<Record<string, unknown>>(parsed.enriched).length
    ? asArray<Record<string, unknown>>(parsed.enriched)
    : asArray<Record<string, unknown>>(parsed.places)

  const enriched = enrichedRaw
    .map((item) => {
      let gPlace: GooglePlace | undefined
      if (typeof item.googleIndex === 'number') {
        gPlace = googlePlaces[item.googleIndex]
      } else if (typeof item.name === 'string') {
        const itemName = item.name
        gPlace = googlePlaces.find((g) => g.name.toLowerCase() === itemName.toLowerCase())
      }
      if (!gPlace) return null

      return {
        ...gPlace,
        description: asString(item.description),
        whyThisGroup: asString(item.whyThisGroup, 'Dopasowanie do profilu grupy: brak danych'),
        groupFitNote: asString(item.groupFitNote),
        bestTime: asString(item.bestTime),
        visitTips: asString(item.visitTips),
        reviewSummary: asString(item.reviewSummary),
        // Świeże opinie to prawdziwe recenzje z Google (na gPlace), nie wymysł AI.
        recentReviewHighlights: asArray<string>(gPlace.recentReviewHighlights).length
          ? asArray<string>(gPlace.recentReviewHighlights).slice(0, 3)
          : asArray<string>(item.recentReviewHighlights).slice(0, 3),
        tags: whitelistTags(gPlace.tags, item.tags),
        estimatedCost: asString(item.estimatedCost),
        sourceCount:
          typeof item.sourceCount === 'number' && item.sourceCount >= 0 ? item.sourceCount : 0,
        sentiment: asString(item.sentiment),
        authenticityNote: asString(item.authenticityNote),
      }
    })
    .filter(Boolean)

  return enriched
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const activities = asArray<string>(body.activities)
    const inputGooglePlaces = asArray<GooglePlace>(body.googlePlaces)

    const region = asString(body.region, '')
    const baseCity = asString(body.baseCity, '')
    const transport = typeof body.transport === 'string' ? body.transport : undefined
    const accommodation =
      typeof body.accommodation === 'string' ? body.accommodation : undefined
    const intensity = typeof body.intensity === 'string' ? body.intensity : undefined
    const numPeople = typeof body.numPeople === 'number' ? body.numPeople : undefined
    const tripDays = typeof body.tripDays === 'number' ? body.tripDays : null
    const searchMode = normalizeMode(body.searchMode ?? body.mode)
    // Liczba wzbogacanych miejsc zależy od wejścia (nie sztywny limit), ograniczona
    // jedynie buforem bezpieczeństwa. Współbieżność wywołań AI trzyma MAX_CONCURRENT_CHUNKS.
    const googlePlaces = inputGooglePlaces.slice(0, MAX_ENRICH_PLACES)
    const diagnostics = {
      inputGooglePlaces: inputGooglePlaces.length,
      googlePlacesSentToAI: googlePlaces.length,
      searchMode,
      parseOk: false,
      deepseekStatus: 0,
      deepseekError: '',
      promptMode: 'google_only',
    }

    if (!region || !baseCity) {
      return NextResponse.json({
        places: [],
        error: 'Missing region or baseCity',
        meta: diagnostics,
      })
    }

    if (googlePlaces.length === 0) {
      return NextResponse.json({ places: [], meta: diagnostics })
    }

    const country = REGION_TO_COUNTRY[region.toLowerCase()] || region
    const profileLines = buildProfileLines({
      numPeople,
      transport,
      accommodation,
      intensity,
      activities,
      tripDays,
      baseCity,
      country,
    })

    // Enrich Google places in small parallel chunks so each DeepSeek
    // response stays within the token budget and parses reliably.
    const chunks = chunkArray(googlePlaces, CHUNK_SIZE)
    const chunkResults = await mapLimit(chunks, MAX_CONCURRENT_CHUNKS, (chunk) =>
      enrichGoogleChunk({ searchMode, profileLines, chunk }),
    )
    const enriched = chunkResults.flatMap((r) => r.enriched)
    const fallbackChunks = chunkResults.filter((r) => !r.parseOk).length

    diagnostics.deepseekStatus = chunkResults.some((r) => r.parseOk)
      ? 200
      : chunkResults[0]?.status ?? 0
    diagnostics.parseOk = fallbackChunks === 0
    if (!diagnostics.parseOk) diagnostics.deepseekError = 'parse_failed_partial'

    return NextResponse.json({
      places: enriched,
      meta: {
        ...diagnostics,
        usedFallback: fallbackChunks > 0,
        fallbackChunks,
        totalChunks: chunks.length,
      },
    })
  } catch (err) {
    return NextResponse.json({
      places: [],
      error: String(err),
      meta: {
        deepseekError: String(err),
      },
    })
  }
}
