import { NextRequest, NextResponse } from 'next/server'

const ACTIVITY_QUERIES: Record<string, string[]> = {
  sup: ['Slovenia SUP paddleboard lake', 'Bled Bohinj SUP kayak paddle', 'Soča river kayak SUP', 'Slovenia lake swimming paddle'],
  trekking: ['Slovenia hiking trail hidden gem', 'Julian Alps trekking route', 'Slovenia waterfall hike', 'Triglav area hiking recommend'],
  food: ['Slovenia local restaurant recommend', 'Ljubljana food market eat', 'Slovenia traditional food must try', 'Slovenia hidden gem restaurant'],
  sunset: ['Slovenia viewpoint sunset panorama', 'Bled viewpoint photography spot', 'Slovenia best panorama view'],
  sightseeing: ['Slovenia hidden gem tourist', 'Ljubljana worth visiting', 'Slovenia underrated attraction'],
  nightlife: ['Ljubljana nightlife bar recommend', 'Ljubljana craft beer bar', 'Slovenia evening entertainment'],
  markets: ['Ljubljana market local products', 'Slovenia farmers market', 'Slovenia local craft market'],
  photo: ['Slovenia photography spot landscape', 'Slovenia instagram location', 'Bled photography best angle'],
  relax: ['Slovenia thermal spa relax', 'Slovenia peaceful nature swim', 'Slovenia slow travel relax'],
  cycling: ['Slovenia cycling route bike trail', 'Ljubljana bike cycling path', 'Slovenia scenic bike route'],
  van: ['Slovenia wild camping spot van', 'Slovenia campervan parking spot', 'Slovenia free camping nature'],
  tent: ['Slovenia camping nature spot', 'Slovenia best campsite wild', 'Slovenia tent camping recommend'],
}

const BUDAPEST_QUERIES: Record<string, string[]> = {
  food: ['Budapest local food restaurant hidden gem', 'Budapest must eat traditional'],
  sightseeing: ['Budapest hidden gem worth visiting', 'Budapest underrated attraction'],
  nightlife: ['Budapest ruin bar experience recommend', 'Budapest nightlife guide'],
  relax: ['Budapest thermal bath recommend', 'Budapest spa experience'],
  markets: ['Budapest market local shopping', 'Budapest great market hall'],
  sup: ['Budapest Danube kayak SUP paddle'],
  photo: ['Budapest photography spot sunset', 'Budapest best view panorama'],
  sunset: ['Budapest sunset viewpoint panorama'],
}

async function fetchRedditPosts(query: string): Promise<any[]> {
  try {
    const res = await fetch(
      `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=top&limit=10&t=year`,
      { headers: { 'User-Agent': 'SloveniaTripPlanner/1.0' }, next: { revalidate: 3600 } }
    )
    if (!res.ok) return []
    const data = await res.json()
    return (data.data?.children || [])
      .filter((c: any) => ['Slovenia', 'travel', 'vandwellers', 'solotravel', 'kayaking', 'hiking', 'EuropeTravel', 'budapest', 'Hungary'].includes(c.data.subreddit))
      .map((c: any) => ({
        title: c.data.title,
        score: c.data.score,
        url: `https://reddit.com${c.data.permalink}`,
        subreddit: c.data.subreddit,
        text: (c.data.selftext || '').slice(0, 400),
      }))
  } catch { return [] }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { activities = [], region = 'slovenia', transport, accommodation, intensity, numPeople, startDate, endDate, tripDays } = body

    // Wybierz zapytania na podstawie aktywności i regionu
    const queryMap = region === 'budapest' ? BUDAPEST_QUERIES : ACTIVITY_QUERIES
    const queries: string[] = []
    for (const act of activities) {
      const q = queryMap[act] || ACTIVITY_QUERIES[act] || []
      queries.push(...q.slice(0, 2))
    }
    // Zawsze dodaj ogólne zapytanie
    queries.push(region === 'budapest' ? 'Budapest travel tips hidden gem' : 'Slovenia travel tips hidden gem')

    // Pobierz posty (max 5 zapytań)
    const allPosts: any[] = []
    const uniqueUrls = new Set<string>()
    for (const q of queries.slice(0, 5)) {
      const posts = await fetchRedditPosts(q)
      for (const p of posts) {
        if (!uniqueUrls.has(p.url)) {
          uniqueUrls.add(p.url)
          allPosts.push(p)
        }
      }
    }

    const postsToAnalyze = allPosts.filter(p => p.score >= 5).slice(0, 25)

    if (postsToAnalyze.length === 0) {
      return NextResponse.json({ places: [], postsAnalyzed: 0 })
    }

    // Oblicz ile dni i kiedy
    const daysInfo = tripDays ? `${tripDays} dni` : startDate && endDate
      ? `${Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000)} dni`
      : 'nieznana liczba dni'

    const transportLabels: Record<string, string> = {
      van: 'van/kamper', own_car: 'własny samochód', rental: 'wynajem auta', motorcycle: 'motocykl'
    }
    const accommodationLabels: Record<string, string> = {
      tent: 'namiot/camping', van: 'van/kamper', airbnb: 'Airbnb/domki', hotel: 'hotel/hostel'
    }
    const intensityLabels: Record<string, string> = {
      slow: 'spokojne tempo', balanced: 'zbalansowane', intense: 'intensywne'
    }

    // Wyślij do DeepSeek
    const deepseekRes = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        max_tokens: 2000,
        messages: [
          {
            role: 'system',
            content: `Jesteś ekspertem od podróży po Słowenii i Budapeszcie. Analizujesz posty z Reddit i wyciągasz konkretne rekomendacje miejsc. Zawsze odpowiadasz TYLKO w formacie JSON, bez żadnego tekstu przed ani po.`,
          },
          {
            role: 'user',
            content: `Przeanalizuj poniższe posty z Reddit i wyciągnij maksymalnie 8 konkretnych miejsc/restauracji/aktywności wartych odwiedzenia.

PROFIL EKIPY:
- Liczba osób: ${numPeople || 4}
- Transport: ${transportLabels[transport] || transport || 'samochód'}
- Nocleg: ${accommodationLabels[accommodation] || accommodation || 'różny'}
- Tempo: ${intensityLabels[intensity] || intensity || 'zbalansowane'}
- Aktywności: ${activities.join(', ') || 'ogólne zwiedzanie'}
- Czas trwania: ${daysInfo}
- Region: ${region === 'budapest' ? 'Budapeszt' : 'Słowenia'}

POSTY Z REDDIT (${postsToAnalyze.length} postów):
${postsToAnalyze.map((p, i) => `[${i + 1}] r/${p.subreddit} | ${p.score}pkt | "${p.title}"${p.text ? `\n${p.text}` : ''}`).join('\n\n')}

Zwróć JSON w tej strukturze:
{
  "places": [
    {
      "name": "Nazwa miejsca",
      "description": "2-3 zdania — co to jest i dlaczego pasuje tej konkretnej ekipie",
      "whyThisGroup": "1 zdanie — konkretnie dlaczego pasuje do ich aktywności/transportu/noclegu",
      "tags": ["sup", "food"],
      "region": "slovenia",
      "subregion": "Bled",
      "estimatedCost": "free|cheap|moderate|expensive",
      "bestTimeOfDay": "morning|afternoon|evening|anytime",
      "sourceCount": 3,
      "sourcePosts": [1, 3, 5],
      "sentiment": "pozytywny"
    }
  ]
}

Gdzie region to "slovenia" lub "budapest". Sortuj po sourceCount malejąco.`,
          }
        ],
      }),
    })

    if (!deepseekRes.ok) {
      return NextResponse.json({ places: [], postsAnalyzed: postsToAnalyze.length, error: 'DeepSeek error' })
    }

    const deepseekData = await deepseekRes.json()
    const rawText = deepseekData.choices?.[0]?.message?.content || '{}'

    let parsed: any = { places: [] }
    try {
      const clean = rawText.replace(/```json|```/g, '').trim()
      parsed = JSON.parse(clean)
    } catch {}

    // Wzbogać o linki do postów
    const places = (parsed.places || []).map((place: any) => ({
      ...place,
      sources: (place.sourcePosts || [])
        .map((i: number) => postsToAnalyze[i - 1])
        .filter(Boolean)
        .map((p: any) => ({ title: p.title, url: p.url, score: p.score, subreddit: p.subreddit })),
    }))

    return NextResponse.json({
      places,
      postsAnalyzed: postsToAnalyze.length,
    })
  } catch (err) {
    return NextResponse.json({ places: [], postsAnalyzed: 0, error: String(err) })
  }
}
