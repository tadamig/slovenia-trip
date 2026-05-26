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

function buildPrompt(body: any, batch: 1 | 2): string {
  const { posts = [], activities = [], region = 'slovenia', transport, accommodation, intensity, numPeople, tripDays } = body
  const daysInfo = tripDays ? `${tripDays} dni` : 'nieznana liczba dni'

  const excludeNote = batch === 2
    ? '\nWAŻNE: To jest druga partia — zwróć INNE miejsca niż te które mogłeś już wymienić w pierwszej partii. Skup się na mniej oczywistych, lokalnych, ukrytych perełkach.'
    : '\nWAŻNE: To jest pierwsza partia — zwróć najbardziej dopasowane i polecane miejsca.'

  return `Przeanalizuj poniższe posty z Reddit i wyciągnij dokładnie 10 konkretnych miejsc/restauracji/aktywności wartych odwiedzenia.${excludeNote}

PROFIL EKIPY:
- Liczba osób: ${numPeople || 4}
- Transport: ${transportLabels[transport] || transport || 'samochód'}
- Nocleg: ${accommodationLabels[accommodation] || accommodation || 'różny'}
- Tempo: ${intensityLabels[intensity] || intensity || 'zbalansowane'}
- Aktywności: ${activities.join(', ') || 'ogólne zwiedzanie'}
- Czas trwania: ${daysInfo}
- Region: ${region === 'budapest' ? 'Budapeszt' : 'Słowenia'}

POSTY Z REDDIT (${posts.length} postów):
${posts.map((p: any, i: number) => `[${i + 1}] r/${p.subreddit} | ${p.score}pkt | "${p.title}"${p.text ? '\n' + p.text : ''}`).join('\n\n')}

Zwróć JSON:
{
  "places": [
    {
      "name": "Nazwa miejsca",
      "description": "2-3 zdania dlaczego pasuje tej ekipie",
      "whyThisGroup": "1 zdanie konkretnie dlaczego",
      "tags": ["sup", "food"],
      "region": "slovenia",
      "subregion": "Bled",
      "lat": 46.3683,
      "lon": 14.1146,
      "estimatedCost": "free|cheap|moderate|expensive",
      "sourceCount": 3,
      "sourcePosts": [1, 3, 5],
      "sentiment": "pozytywny"
    }
  ]
}

Każde miejsce MUSI mieć lat i lon (współrzędne GPS). Sortuj po sourceCount malejąco.`
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { posts = [], batch = 1 } = body

    if (posts.length === 0) {
      return NextResponse.json({ places: [], postsAnalyzed: 0 })
    }

    const deepseekRes = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        max_tokens: 2500,
        messages: [
          {
            role: 'system',
            content: 'Jesteś ekspertem od podróży po Słowenii i Budapeszcie. Zawsze odpowiadasz TYLKO w formacie JSON, bez żadnego tekstu przed ani po.',
          },
          {
            role: 'user',
            content: buildPrompt(body, batch as 1 | 2),
          }
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
