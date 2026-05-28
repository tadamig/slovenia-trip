import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 60

type SearchMode = 'standard' | 'research'

type RedditPost = {
  title: string
  url: string
  score: number
  subreddit: string
  text?: string
}

type GooglePlace = {
  name: string
  googlePlaceId?: string
  tags?: string[]
  [key: string]: unknown
}

type SourceLink = {
  title: string
  url: string
  score: number
  subreddit: string
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

function asSourceLinks(sourcePosts: unknown, posts: RedditPost[]): SourceLink[] {
  return asArray<number>(sourcePosts)
    .map((i) => posts[i - 1])
    .filter(Boolean)
    .map((p) => ({
      title: p.title,
      url: p.url,
      score: p.score,
      subreddit: p.subreddit,
    }))
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  if (!raw) return null

  const normalized = raw.replace(/```json|```/gi, '').trim()
  try {
    const parsed = JSON.parse(normalized)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    const start = normalized.indexOf('{')
    const end = normalized.lastIndexOf('}')
    if (start >= 0 && end > start) {
      const sliced = normalized.slice(start, end + 1)
      try {
        const parsed = JSON.parse(sliced)
        return parsed && typeof parsed === 'object' ? parsed : null
      } catch {
        return null
      }
    }
    return null
  }
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

function buildGooglePrompt(params: {
  searchMode: SearchMode
  profileLines: string
  country: string
  posts: RedditPost[]
  googlePlaces: GooglePlace[]
}) {
  const { searchMode, profileLines, country, posts, googlePlaces } = params
  const styleNote =
    searchMode === 'research'
      ? 'Tryb RESEARCH: priorytet dla unikalnych i lokalnych miejsc (natura, szlaki, punkty widokowe, ukryte perełki).'
      : 'Tryb STANDARD: priorytet dla sprawdzonych i popularnych miejsc z dobrym user experience.'

  const googleLines = googlePlaces
    .map(
      (p, i) =>
        `[G${i + 1}] ${p.name} | ${asString(p.address, '')} | typy: ${asArray<string>(p.types).slice(0, 4).join(', ')}`,
    )
    .join('\n')

  const postLines = posts
    .map(
      (p, i) =>
        `[${i + 1}] r/${p.subreddit} | ${p.score} pkt | "${p.title}"${
          p.text ? `\n${p.text.slice(0, 220)}` : ''
        }`,
    )
    .join('\n\n')

  return `Jestes ekspertem od podrozy. Odpowiadasz tylko poprawnym JSON-em.
${styleNote}

PROFIL EKIPY:
${profileLines}

ZADANIE 1 - Wzbogac miejsca z Google:
${googleLines}

ZADANIE 2 - Znajdz lokalne polecajki z Reddit, ktorych nie ma na liscie Google:
${postLines || 'Brak postow Reddit - zwroc pusta tablice localGems.'}

WYMAGANIA:
- Dla kazdego miejsca zwroc informacje "dla calej ekipy", nie dla pojedynczych osob.
- Gdy nie masz danych dla pola, wpisz "brak danych".
- "recentReviewHighlights" max 3 krotkie punkty.

Zwroc obiekt JSON:
{
  "enriched": [
    {
      "googleIndex": 0,
      "description": "2-3 zdania",
      "whyThisGroup": "dlaczego pasuje calej ekipie",
      "groupFitNote": "krotka etykieta dopasowania grupowego",
      "bestTime": "najlepsza pora dnia/sezon albo brak danych",
      "visitTips": "jak dojsc / praktyczna wskazowka albo brak danych",
      "reviewSummary": "krotkie podsumowanie opinii",
      "recentReviewHighlights": ["punkt 1", "punkt 2"],
      "tags": ["trekking", "food"],
      "estimatedCost": "free|cheap|moderate|expensive|brak danych",
      "sourceCount": 2,
      "sourcePosts": [1, 3],
      "sentiment": "pozytywny|neutralny|mieszany|brak danych",
      "authenticityNote": "krotka notatka lub brak danych"
    }
  ],
  "localGems": [
    {
      "name": "Nazwa miejsca",
      "description": "2-3 zdania",
      "whyThisGroup": "dlaczego pasuje ekipie",
      "groupFitNote": "krotka etykieta dopasowania grupowego",
      "bestTime": "najlepsza pora dnia/sezon albo brak danych",
      "visitTips": "jak dojsc / praktyczna wskazowka albo brak danych",
      "reviewSummary": "krotkie podsumowanie zrodel",
      "recentReviewHighlights": ["punkt 1", "punkt 2"],
      "tags": ["sunset"],
      "country": "${country}",
      "subregion": "okolica",
      "estimatedCost": "free|cheap|moderate|expensive|brak danych",
      "sourceCount": 1,
      "sourcePosts": [2],
      "sentiment": "pozytywny|neutralny|mieszany|brak danych"
    }
  ]
}`
}

function buildRedditOnlyPrompt(params: {
  searchMode: SearchMode
  profileLines: string
  country: string
  baseCity: string
  posts: RedditPost[]
  region: string
  batch: number
}) {
  const { searchMode, profileLines, country, baseCity, posts, region, batch } = params
  const batchNote =
    batch === 2
      ? 'Druga partia: skup sie na mniej oczywistych propozycjach.'
      : 'Pierwsza partia: zwroc najbardziej wartosciowe miejsca.'
  const styleNote =
    searchMode === 'research'
      ? 'Tryb RESEARCH: priorytet dla lokalnych perelek, mniej oczywistych miejsc i natury.'
      : 'Tryb STANDARD: balans miedzy klasykami a ciekawymi miejscami.'

  const postLines = posts
    .map(
      (p, i) =>
        `[${i + 1}] r/${p.subreddit} | ${p.score} pkt | "${p.title}"${
          p.text ? `\n${p.text.slice(0, 220)}` : ''
        }`,
    )
    .join('\n\n')

  return `Jestes ekspertem od podrozy. Odpowiedz tylko poprawnym JSON-em.
${batchNote}
${styleNote}

PROFIL EKIPY:
${profileLines}
- Region: ${country}, okolice ${baseCity} (max 100km)

POSTY Z REDDIT (${posts.length}):
${postLines}

Zwroc JSON:
{
  "places": [
    {
      "name": "Nazwa miejsca",
      "description": "2-3 zdania",
      "whyThisGroup": "dlaczego pasuje ekipie",
      "groupFitNote": "krotka etykieta dopasowania grupowego",
      "bestTime": "najlepsza pora dnia/sezon albo brak danych",
      "visitTips": "jak dojsc / praktyczna wskazowka albo brak danych",
      "reviewSummary": "krotkie podsumowanie zrodel",
      "recentReviewHighlights": ["punkt 1", "punkt 2"],
      "tags": ["trekking", "food"],
      "region": "${region}",
      "subregion": "okolica",
      "country": "${country}",
      "lat": 46.3,
      "lon": 14.1,
      "distanceFromBase": 45,
      "estimatedCost": "free|cheap|moderate|expensive|brak danych",
      "sourceCount": 3,
      "sourcePosts": [1, 3, 5],
      "sentiment": "pozytywny|neutralny|mieszany|brak danych",
      "localityScore": 8,
      "authenticityNote": "krotka notatka lub brak danych"
    }
  ]
}`
}

async function callDeepSeek(prompt: string) {
  return fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      max_tokens: 4000,
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
  })
}

function normalizeEnrichedResult(params: {
  parsed: Record<string, unknown>
  googlePlaces: GooglePlace[]
  posts: RedditPost[]
}) {
  const { parsed, googlePlaces, posts } = params
  const enrichedRaw = asArray<Record<string, unknown>>(parsed.enriched).length
    ? asArray<Record<string, unknown>>(parsed.enriched)
    : asArray<Record<string, unknown>>(parsed.places)

  const enriched = enrichedRaw
    .map((item) => {
      let gPlace: GooglePlace | undefined
      if (typeof item.googleIndex === 'number') {
        gPlace = googlePlaces[item.googleIndex]
      } else if (typeof item.name === 'string') {
        gPlace = googlePlaces.find((g) => g.name.toLowerCase() === item.name!.toLowerCase())
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
        recentReviewHighlights: asArray<string>(item.recentReviewHighlights).slice(0, 3),
        tags: asArray<string>(item.tags).length
          ? asArray<string>(item.tags)
          : asArray<string>(gPlace.tags),
        estimatedCost: asString(item.estimatedCost),
        sourceCount:
          typeof item.sourceCount === 'number' && item.sourceCount >= 0 ? item.sourceCount : 0,
        sentiment: asString(item.sentiment),
        authenticityNote: asString(item.authenticityNote),
        sources: asSourceLinks(item.sourcePosts, posts),
      }
    })
    .filter(Boolean)

  const localGems = asArray<Record<string, unknown>>(parsed.localGems).map((place) => ({
    ...place,
    name: asString(place.name),
    description: asString(place.description),
    whyThisGroup: asString(place.whyThisGroup, 'Dopasowanie do profilu grupy: brak danych'),
    groupFitNote: asString(place.groupFitNote),
    bestTime: asString(place.bestTime),
    visitTips: asString(place.visitTips),
    reviewSummary: asString(place.reviewSummary),
    recentReviewHighlights: asArray<string>(place.recentReviewHighlights).slice(0, 3),
    tags: asArray<string>(place.tags),
    source: 'reddit',
    sourceCount:
      typeof place.sourceCount === 'number' && place.sourceCount >= 0 ? place.sourceCount : 0,
    sentiment: asString(place.sentiment),
    sources: asSourceLinks(place.sourcePosts, posts),
  }))

  return { enriched, localGems }
}

function normalizeRedditPlaces(parsed: Record<string, unknown>, posts: RedditPost[]) {
  return asArray<Record<string, unknown>>(parsed.places).map((place) => ({
    ...place,
    name: asString(place.name),
    description: asString(place.description),
    whyThisGroup: asString(place.whyThisGroup, 'Dopasowanie do profilu grupy: brak danych'),
    groupFitNote: asString(place.groupFitNote),
    bestTime: asString(place.bestTime),
    visitTips: asString(place.visitTips),
    reviewSummary: asString(place.reviewSummary),
    recentReviewHighlights: asArray<string>(place.recentReviewHighlights).slice(0, 3),
    tags: asArray<string>(place.tags),
    estimatedCost: asString(place.estimatedCost),
    sentiment: asString(place.sentiment),
    sourceCount:
      typeof place.sourceCount === 'number' && place.sourceCount >= 0 ? place.sourceCount : 0,
    sources: asSourceLinks(place.sourcePosts, posts),
  }))
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const posts = asArray<RedditPost>(body.posts)
    const activities = asArray<string>(body.activities)
    const googlePlaces = asArray<GooglePlace>(body.googlePlaces)

    const region = asString(body.region, '')
    const baseCity = asString(body.baseCity, '')
    const transport = typeof body.transport === 'string' ? body.transport : undefined
    const accommodation =
      typeof body.accommodation === 'string' ? body.accommodation : undefined
    const intensity = typeof body.intensity === 'string' ? body.intensity : undefined
    const numPeople = typeof body.numPeople === 'number' ? body.numPeople : undefined
    const tripDays = typeof body.tripDays === 'number' ? body.tripDays : null
    const batch = typeof body.batch === 'number' ? body.batch : 1
    const searchMode = normalizeMode(body.searchMode ?? body.mode)

    if (!region || !baseCity) {
      return NextResponse.json({
        places: [],
        localGems: [],
        postsAnalyzed: 0,
        error: 'Missing region or baseCity',
      })
    }

    if (posts.length === 0 && googlePlaces.length === 0) {
      return NextResponse.json({ places: [], localGems: [], postsAnalyzed: 0 })
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
    const hasGooglePlaces = googlePlaces.length > 0

    const prompt = hasGooglePlaces
      ? buildGooglePrompt({ searchMode, profileLines, country, posts, googlePlaces })
      : buildRedditOnlyPrompt({
          searchMode,
          profileLines,
          country,
          baseCity,
          posts,
          region,
          batch,
        })

    const deepseekRes = await callDeepSeek(prompt)
    if (!deepseekRes.ok) {
      return NextResponse.json({
        places: [],
        localGems: [],
        postsAnalyzed: posts.length,
        error: 'DeepSeek error',
      })
    }

    const deepseekData = await deepseekRes.json()
    const rawText = deepseekData.choices?.[0]?.message?.content || '{}'
    let parsed = parseJsonObject(rawText)

    // One retry only when the model returns an invalid payload.
    if (!parsed) {
      const retryRes = await callDeepSeek(
        `${prompt}\n\nPOPRAWKA: odpowiedz musi byc jednym obiektem JSON bez markdown i bez dodatkowego tekstu.`,
      )
      if (retryRes.ok) {
        const retryData = await retryRes.json()
        const retryRawText = retryData.choices?.[0]?.message?.content || '{}'
        parsed = parseJsonObject(retryRawText)
      }
    }

    if (!parsed) parsed = {}

    if (hasGooglePlaces) {
      const { enriched, localGems } = normalizeEnrichedResult({ parsed, googlePlaces, posts })

      // Safety fallback: keep Google results visible even if enrichment failed.
      const safePlaces =
        enriched.length > 0
          ? enriched
          : googlePlaces.map((p) => ({
              ...p,
              description: 'brak danych',
              whyThisGroup: 'Dopasowanie do profilu grupy: brak danych',
              groupFitNote: 'brak danych',
              bestTime: 'brak danych',
              visitTips: 'brak danych',
              reviewSummary: 'brak danych',
              recentReviewHighlights: [] as string[],
              tags: asArray<string>(p.tags),
              estimatedCost: 'brak danych',
              sourceCount: 0,
              sentiment: 'brak danych',
              authenticityNote: 'brak danych',
              sources: [] as SourceLink[],
            }))

      return NextResponse.json({
        places: safePlaces,
        localGems,
        postsAnalyzed: posts.length,
        meta: {
          searchMode,
          usedFallback: enriched.length === 0,
        },
      })
    }

    const places = normalizeRedditPlaces(parsed, posts)
    return NextResponse.json({
      places,
      localGems: [],
      postsAnalyzed: posts.length,
      meta: { searchMode, usedFallback: false },
    })
  } catch (err) {
    return NextResponse.json({
      places: [],
      localGems: [],
      postsAnalyzed: 0,
      error: String(err),
    })
  }
}
