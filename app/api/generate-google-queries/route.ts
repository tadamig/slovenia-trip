import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 60

const REGION_TO_COUNTRY: Record<string, string> = {
  slovenia: 'Slovenia', budapest: 'Hungary', croatia: 'Croatia',
  austria: 'Austria', italy: 'Italy', czechia: 'Czech Republic',
  poland: 'Poland', germany: 'Germany', france: 'France', spain: 'Spain',
}

export async function POST(request: NextRequest) {
  try {
    const {
      activities = [],
      baseCity,
      region,
      budget,
      food = [],
      tripDays,
      month,
      searchMode = 'standard',
    } = await request.json()
    if (!baseCity || !region) return NextResponse.json({ queries: [] }, { status: 400 })

    const country = REGION_TO_COUNTRY[region.toLowerCase()] || region
    const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
    const monthName = month ? MONTH_NAMES[month - 1] : 'summer'
    const budgetHint = budget === 'budget' ? 'budget cheap' : budget === 'mid' ? 'mid-range' : ''
    const modeHint = searchMode === 'research'
      ? 'Focus: local and less obvious discoveries, viewpoints, hidden lakes, trails, and authentic local food.'
      : 'Focus: balanced and reliable trip spots, including popular attractions and practical choices.'

    const prompt = `Generate 15 Google Places search queries for a trip to ${baseCity}, ${country} in ${monthName}.

Activities: ${(activities || []).join(', ') || 'sightseeing'}
${budgetHint ? `Budget: ${budgetHint}` : ''}
${food.length > 0 && !food.includes('anything') ? `Food: ${food.join(', ')}` : ''}
Mode: ${searchMode}
${modeHint}

Rules:
- 2-3 queries per activity targeting ${baseCity} or ${country}
- Include local language queries (e.g. Italian for Italy)
- Mix specific venue types with general discoveries
- 3-6 words each, no quotes

Return ONLY a JSON array: ["query 1", "query 2", ...]`

    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        max_tokens: 400,
        messages: [
          { role: 'system', content: 'Return ONLY a JSON array of strings. No explanation, no markdown.' },
          { role: 'user', content: prompt },
        ],
      }),
    })

    if (!res.ok) return NextResponse.json({ queries: getFallback(activities, baseCity, country) })

    const data = await res.json()
    const raw = data.choices?.[0]?.message?.content || '[]'
    let queries: string[] = []
    try { queries = JSON.parse(raw.replace(/```json|```/g, '').trim()) } catch {}
    if (!Array.isArray(queries) || queries.length === 0) queries = getFallback(activities, baseCity, country)

    return NextResponse.json({ queries: queries.slice(0, 15) })
  } catch (err) {
    return NextResponse.json({ queries: [], error: String(err) })
  }
}

function getFallback(activities: string[], baseCity: string, country: string): string[] {
  const q = [`things to do ${baseCity}`, `best restaurant ${baseCity}`, `${country} hidden gem`]
  if ((activities || []).includes('sup')) q.push(`SUP rental ${baseCity}`, `kayak ${baseCity}`)
  if ((activities || []).includes('trekking')) q.push(`hiking trail ${baseCity}`, `nature walk ${baseCity}`)
  if ((activities || []).includes('food')) q.push(`local restaurant ${baseCity}`)
  if ((activities || []).includes('nightlife')) q.push(`bar ${baseCity}`, `aperitivo ${baseCity}`)
  if ((activities || []).includes('cycling')) q.push(`bike trail ${baseCity}`)
  return q
}
