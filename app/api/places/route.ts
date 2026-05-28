import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 60

const REGION_TO_COUNTRY: Record<string, string> = {
  slovenia: 'Slovenia', budapest: 'Hungary', croatia: 'Croatia',
  austria: 'Austria', italy: 'Italy', czechia: 'Czech Republic',
  poland: 'Poland', germany: 'Germany', france: 'France', spain: 'Spain',
}

const transportLabels: Record<string, string> = {
  van: 'van/kamper', own_car: 'własny samochód', rental: 'wynajem auta', motorcycle: 'motocykl'
}
const accommodationLabels: Record<string, string> = {
  tent: 'namiot/camping', van: 'van/kamper', airbnb: 'Airbnb/domki', hotel: 'hotel/hostel'
}
const intensityLabels: Record<string, string> = {
  slow: 'spokojne tempo', balanced: 'zbalansowane', intense: 'intensywne'
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      posts = [],
      activities = [],
      region,
      baseCity,
      transport,
      accommodation,
      intensity,
      numPeople,
      startDate,
      endDate,
      tripDays,
      batch = 1,
      googlePlaces = [],
    } = body

    if (!region || !baseCity) {
      return NextResponse.json({ places: [], postsAnalyzed: 0, error: 'Missing region or baseCity' })
    }
    if (posts.length === 0 && googlePlaces.length === 0) {
      return NextResponse.json({ places: [], postsAnalyzed: 0 })
    }

    const country = REGION_TO_COUNTRY[region] || region
    const daysInfo = tripDays ? `${tripDays} dni` : 'nieznana liczba dni'
    const hasGooglePlaces = googlePlaces.length > 0

    const profileLines = [
      `- Liczba osób: ${numPeople || 4}`,
      `- Transport: ${transportLabels[transport] || transport || 'samochód'}`,
      `- Nocleg: ${accommodationLabels[accommodation] || accommodation || 'różny'}`,
      `- Tempo: ${intensityLabels[intensity] || intensity || 'zbalansowane'}`,
      `- Aktywności: ${activities.join(', ') || 'ogólne zwiedzanie'}`,
      `- Czas trwania: ${daysInfo}`,
      `- Baza noclegowa: ${baseCity}, ${country}`,
    ].join('\n')

    const postLines = posts
      .map((p: any, i: number) => `[${i + 1}] r/${p.subreddit} | ${p.score}pkt | "${p.title}"${p.text ? '\n' + p.text.slice(0, 200) : ''}`)
      .join('\n\n')

    let prompt: string

    if (hasGooglePlaces) {
      const googleLines = googlePlaces
        .map((p: any, i: number) => `[G${i + 1}] ${p.name} | ${p.address || ''} | typy: ${(p.types || []).slice(0, 3).join(', ')}`)
        .join('\n')

      prompt = `Jesteś ekspertem od podróży. Masz dwa zadania naraz.

PROFIL EKIPY:
${profileLines}

ZADANIE 1 — Wzbogać miejsca z Google:
Dla każdego miejsca napisz opis i tagi dopasowane do profilu ekipy.
${googleLines}

ZADANIE 2 — Znajdź lokalne perełki z Reddit których NIE MA na liście Google:
${postLines}

Zwróć JSON:
{
  "enriched": [
    {
      "googleIndex": 0,
      "description": "2-3 zdania co to jest i dlaczego warto",
      "whyThisGroup": "1 zdanie dlaczego pasuje tej ekipie",
      "tags": ["sup", "food"],
      "estimatedCost": "free|cheap|moderate|expensive",
      "sourceCount": 2,
      "sourcePosts": [1, 3],
      "sentiment": "pozytywny",
      "authenticityNote": "notatka"
    }
  ],
  "localGems": [
    {
      "name": "Nazwa miejsca",
      "description": "2-3 zdania",
      "whyThisGroup": "1 zdanie",
      "tags": ["trekking"],
      "country": "${country}",
      "subregion": "okolica",
      "estimatedCost": "free|cheap|moderate|expensive",
      "sourceCount": 1,
      "sourcePosts": [2],
      "sentiment": "pozytywny"
    }
  ]
}`
    } else {
      const batchNote = batch === 2
        ? '\nTo DRUGA PARTIA — skup się na ukrytych perełkach, lokalnych restauracjach, nieoczywistych szlakach.'
        : '\nTo PIERWSZA PARTIA — zwróć najbardziej wartościowe i polecane miejsca.'

      prompt = `Jesteś ekspertem od podróży. Analizujesz posty z Reddit i wyciągasz KONKRETNE miejsca warte odwiedzenia.${batchNote}

PROFIL EKIPY:
${profileLines}
- Region: ${country}, okolice ${baseCity} (max 100km)

WAŻNE ZASADY:
- Szukaj miejsc w promieniu ~100km od ${baseCity} ORAZ w całym regionie ${country}
- Priorytet dla miejsc które pojawiają się w WIELU postach
- Każde miejsce MUSI mieć dokładne współrzędne GPS

POSTY Z REDDIT (${posts.length} postów):
${postLines}

Zwróć JSON (dokładnie 10 miejsc):
{
  "places": [
    {
      "name": "Nazwa miejsca",
      "description": "2-3 zdania dlaczego warto i co to jest",
      "whyThisGroup": "1 zdanie dlaczego pasuje tej konkretnej ekipie",
      "tags": ["sup", "food"],
      "region": "${region}",
      "subregion": "Como",
      "country": "${country}",
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
    }

    const deepseekRes = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        max_tokens: 4000,
        messages: [
          { role: 'system', content: 'Jesteś ekspertem od podróży. Zawsze odpowiadasz TYLKO w formacie JSON, bez żadnego tekstu przed ani po. Wszystkie opisy ZAWSZE po polsku.' },
          { role: 'user', content: prompt },
        ],
      }),
    })

    if (!deepseekRes.ok) {
      return NextResponse.json({ places: [], postsAnalyzed: posts.length, error: 'DeepSeek error' })
    }

    const deepseekData = await deepseekRes.json()
    const rawText = deepseekData.choices?.[0]?.message?.content || '{}'

    let parsed: any = { places: [], enriched: [], localGems: [] }
    try {
      const clean = rawText.replace(/```json|```/g, '').trim()
      parsed = JSON.parse(clean)
    } catch {}

    if (hasGooglePlaces) {
      // Obsłuż oba formaty — nowy (enriched) i stary (places)
      const enrichedArray = parsed.enriched || parsed.places || []
      const enrichedPlaces = enrichedArray.map((e: any) => {
        // Jeśli nie ma googleIndex, to jest format bez indeksu - szukaj po nazwie
        const gPlace = e.googleIndex !== undefined ? googlePlaces[e.googleIndex] : googlePlaces.find((g: any) => g.name === e.name)
        if (!gPlace) return null
        return {
          ...gPlace,
          description: e.description,
          whyThisGroup: e.whyThisGroup,
          tags: e.tags || gPlace.tags || [],
          estimatedCost: e.estimatedCost,
          sourceCount: e.sourceCount || 0,
          sentiment: e.sentiment,
          authenticityNote: e.authenticityNote,
          sources: (e.sourcePosts || [])
            .map((i: number) => posts[i - 1])
            .filter(Boolean)
            .map((p: any) => ({ title: p.title, url: p.url, score: p.score, subreddit: p.subreddit })),
        }
      }).filter(Boolean)

      const localGems = (parsed.localGems || []).map((place: any) => ({
        ...place,
        tags: place.tags || [],
        source: 'reddit',
        sources: (place.sourcePosts || [])
          .map((i: number) => posts[i - 1])
          .filter(Boolean)
          .map((p: any) => ({ title: p.title, url: p.url, score: p.score, subreddit: p.subreddit })),
      }))

      return NextResponse.json({ places: enrichedPlaces, localGems, postsAnalyzed: posts.length })
    }

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
