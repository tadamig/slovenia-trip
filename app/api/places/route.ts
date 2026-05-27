import { NextRequest, NextResponse } from 'next/server'

const transportLabels: Record<string, string> = {
  van: 'van/kamper', own_car: 'własny samochód', rental: 'wynajem auta', motorcycle: 'motocykl'
}
const accommodationLabels: Record<string, string> = {
  tent: 'namiot/camping', van: 'van/kamper', airbnb: 'Airbnb/domki', hotel: 'hotel/hostel'
}
const intensityLabels: Record<string, string> = {
  slow: 'spokojne tempo', balanced: 'zbalansowane', intense: 'intensywne'
}

// Generuje zapytania na podstawie aktywności i regionu
function buildQueries(activities: string[], region: string, baseCity: string): string[] {
  const queries: string[] = []
  const country = region === 'budapest' ? 'Hungary Budapest' : region

  const ACTIVITY_TEMPLATES: Record<string, string[]> = {
    sup: [
      `${country} SUP paddleboard lake`,
      `${country} kayak canoe river`,
      `${baseCity} water activities swimming`,
      `${country} best lakes swimming hidden`,
      `${country} SUP spot recommend reddit`,
    ],
    trekking: [
      `${country} hiking trail recommend`,
      `${country} best hike hidden gem`,
      `${baseCity} hiking day trip`,
      `${country} trail waterfall`,
      `${country} trekking tips reddit`,
    ],
    food: [
      `${country} local restaurant must try`,
      `${baseCity} best food eat local`,
      `${country} hidden restaurant gem`,
      `${country} traditional cuisine authentic`,
      `${baseCity} food market street food`,
    ],
    sunset: [
      `${country} best viewpoint sunset`,
      `${baseCity} panorama view`,
      `${country} photography spot landscape`,
      `${country} sunset sunrise spot`,
    ],
    sightseeing: [
      `${country} hidden gem tourist`,
      `${baseCity} worth visiting`,
      `${country} underrated attraction`,
      `${country} off beaten path`,
    ],
    nightlife: [
      `${baseCity} bar nightlife recommend`,
      `${baseCity} craft beer local`,
      `${country} nightlife tips`,
    ],
    markets: [
      `${baseCity} local market farmers`,
      `${country} market souvenir local`,
    ],
    photo: [
      `${country} photography spot`,
      `${baseCity} instagram location`,
      `${country} landscape photo`,
    ],
    relax: [
      `${country} thermal spa bath`,
      `${country} peaceful nature relax`,
      `${baseCity} spa wellness`,
    ],
    cycling: [
      `${country} cycling route bike`,
      `${baseCity} bike trail`,
    ],
  }

  for (const act of activities) {
    const templates = ACTIVITY_TEMPLATES[act] || []
    queries.push(...templates)
  }

  // Zawsze dodaj ogólne zapytania
  queries.push(
    `${country} travel tips hidden gem`,
    `${baseCity} what to do`,
    `${country} recommend reddit`,
    `visit ${country} tips`,
  )

  // Deduplikuj i zwróć max 20
  return Array.from(new Set(queries)).slice(0, 20)
}

// Nasze własne scorowanie miejsca
function scorePlace(mentions: PlaceMention[]): PlaceScore {
  const frequency = mentions.length

  // Autentyczność — małe subreddity > duże
  const authenticSubreddits = ['Slovenia', 'hiking', 'kayaking', 'vandwellers', 'solotravel', 'EuropeTravel', 'hungary', 'budapest']
  const authenticCount = mentions.filter(m => authenticSubreddits.some(s => m.subreddit.toLowerCase().includes(s.toLowerCase()))).length
  const authenticity = Math.min(10, Math.round((authenticCount / Math.max(frequency, 1)) * 10))

  // Engagement — score + komentarze
  const avgScore = mentions.reduce((s, m) => s + m.score, 0) / Math.max(frequency, 1)
  const engagement = Math.min(10, Math.round(Math.log10(avgScore + 1) * 3))

  // Lokalność — czy pojawia się w kontekście lokalnym
  const localKeywords = ['local', 'locals', 'hidden', 'gem', 'authentic', 'underrated', 'off beaten']
  const localCount = mentions.filter(m =>
    localKeywords.some(k => (m.title + m.text).toLowerCase().includes(k))
  ).length
  const locality = Math.min(10, Math.round((localCount / Math.max(frequency, 1)) * 10 + 2))

  const total = Math.round((frequency * 3 + authenticity * 2 + engagement + locality * 2) / 8 * 10) / 10

  return { frequency, authenticity, engagement, locality, total }
}

interface PlaceMention {
  subreddit: string
  score: number
  title: string
  text: string
  url: string
  date?: string
}

interface PlaceScore {
  frequency: number
  authenticity: number
  engagement: number
  locality: number
  total: number
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      posts = [],
      activities = [],
      region = 'slovenia',
      baseCity = 'Ljubljana',
      transport,
      accommodation,
      intensity,
      numPeople,
      startDate,
      endDate,
      tripDays,
      batch = 1,
    } = body

    if (posts.length === 0) {
      return NextResponse.json({ places: [], postsAnalyzed: 0 })
    }

    // Grupuj posty wg tytułów żeby wykryć powtarzające się miejsca
    // (to robi DeepSeek — my przekazujemy mu więcej kontekstu)
    const daysInfo = tripDays ? `${tripDays} dni` : 'nieznana liczba dni'

    const batchNote = batch === 2
      ? '\nTo DRUGA PARTIA — zwróć INNE miejsca niż typowe top listy. Skup się na ukrytych perełkach, lokalnych restauracjach mniej znanych turystom, nieoczywistych szlakach.'
      : '\nTo PIERWSZA PARTIA — zwróć najbardziej wartościowe i polecane miejsca.'

    const prompt = `Jesteś ekspertem od podróży. Analizujesz posty z Reddit i wyciągasz KONKRETNE miejsca warte odwiedzenia.${batchNote}

PROFIL EKIPY:
- Liczba osób: ${numPeople || 4}
- Transport: ${transportLabels[transport] || transport || 'samochód'}
- Nocleg: ${accommodationLabels[accommodation] || accommodation || 'różny'}
- Tempo: ${intensityLabels[intensity] || intensity || 'zbalansowane'}
- Aktywności: ${activities.join(', ') || 'ogólne zwiedzanie'}
- Czas trwania: ${daysInfo}
- Baza noclegowa: ${baseCity}
- Region: ${region === 'budapest' ? 'Budapeszt, Węgry' : `Słowenia i okolice (max 100km od ${baseCity})`}

WAŻNE ZASADY:
- Szukaj miejsc w promieniu ~100km od ${baseCity} ORAZ w całym regionie ${region === 'budapest' ? 'Węgier' : 'Słowenii'}
- Priorytet dla miejsc które pojawiają się w WIELU postach
- Preferuj autentyczne, lokalne miejsca nad turystycznymi top-10
- Każde miejsce MUSI mieć dokładne współrzędne GPS
- Oszacuj odległość od ${baseCity} w km

POSTY Z REDDIT (${posts.length} postów):
${posts.map((p: any, i: number) => `[${i + 1}] r/${p.subreddit} | ${p.score}pkt | "${p.title}"${p.text ? '\n' + p.text.slice(0, 300) : ''}`).join('\n\n')}

Zwróć JSON (dokładnie 10 miejsc):
{
  "places": [
    {
      "name": "Nazwa miejsca",
      "description": "2-3 zdania dlaczego warto i co to jest",
      "whyThisGroup": "1 zdanie dlaczego pasuje tej konkretnej ekipie",
      "tags": ["sup", "food"],
      "region": "slovenia",
      "subregion": "Bled",
      "country": "Slovenia",
      "lat": 46.3683,
      "lon": 14.1146,
      "distanceFromBase": 45,
      "estimatedCost": "free|cheap|moderate|expensive",
      "sourceCount": 3,
      "sourcePosts": [1, 3, 5],
      "sentiment": "pozytywny",
      "localityScore": 8,
      "authenticityNote": "polecane głównie przez lokalnych mieszkańców"
    }
  ]
}`

    const deepseekRes = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        max_tokens: 3000,
        messages: [
          { role: 'system', content: 'Jesteś ekspertem od podróży. Zawsze odpowiadasz TYLKO w formacie JSON, bez żadnego tekstu przed ani po.' },
          { role: 'user', content: prompt },
        ],
      }),
    })

    if (!deepseekRes.ok) {
      return NextResponse.json({ places: [], postsAnalyzed: posts.length, error: 'DeepSeek error' })
    }

    const deepseekData = await deepseekRes.json()
    const rawText = deepseekData.choices?.[0]?.message?.content || '{}'

    let parsed: any = { places: [] }
    try {
      const clean = rawText.replace(/```json|```/g, '').trim()
      parsed = JSON.parse(clean)
    } catch {}

    const places = (parsed.places || []).map((place: any) => ({
      ...place,
      sources: (place.sourcePosts || [])
        .map((i: number) => posts[i - 1])
        .filter(Boolean)
        .map((p: any) => ({ title: p.title, url: p.url, score: p.score, subreddit: p.subreddit })),
    }))

    return NextResponse.json({ places, postsAnalyzed: posts.length })
  } catch (err) {
    return NextResponse.json({ places: [], postsAnalyzed: 0, error: String(err) })
  }
}
