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
      transport,
      accommodation,
      intensity,
      numPeople,
      budget,
      food = [],
      tripDays,
      month,
      searchMode = 'standard',
    } = await request.json()
    if (!baseCity || !region) return NextResponse.json({ queries: [], subreddits: [] }, { status: 400 })

    const country = REGION_TO_COUNTRY[region.toLowerCase()] || region
    const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
    const monthName = month ? MONTH_NAMES[month - 1] : 'summer'
    const modeHint = searchMode === 'research'
      ? 'Strongly prioritize local gems, viewpoints, hidden nature spots, and discussions from local communities.'
      : 'Keep a balanced mix of mainstream recommendations and useful local tips.'

    const prompt = `Generate 15 Reddit search queries for finding local tips about ${baseCity}, ${country} in ${monthName}.

Trip profile:
- Activities: ${(activities || []).join(', ') || 'sightseeing'}
- Group: ${numPeople || 4} people
- Transport: ${transport || 'car'}, Accommodation: ${accommodation || 'various'}
- Pace: ${intensity || 'balanced'}
- Budget: ${budget || 'any'}
- Mode: ${searchMode}
- Guidance: ${modeHint}

Rules:
- Conversational, like what locals or travelers would search
- Include both English and local-language query variants
- In research mode, bias toward hidden gems, local tips, off-beaten-path
- 3-8 words each, no quotes

Also return 10-12 relevant subreddit names.

Return ONLY JSON: {"queries": ["q1", ...], "subreddits": ["sub1", ...]}`

    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        max_tokens: 400,
        messages: [
          { role: 'system', content: 'Return ONLY a JSON object with queries and subreddits arrays. No explanation, no markdown.' },
          { role: 'user', content: prompt },
        ],
      }),
    })

    if (!res.ok) return NextResponse.json({ queries: getFallback(activities, baseCity, country), subreddits: [] })

    const data = await res.json()
    const raw = data.choices?.[0]?.message?.content || '{}'
    let queries: string[] = [], subreddits: string[] = []
    try {
      const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim())
      queries = parsed.queries || []
      subreddits = parsed.subreddits || []
    } catch {}
    if (queries.length === 0) queries = getFallback(activities, baseCity, country)

    return NextResponse.json({ queries: queries.slice(0, 15), subreddits })
  } catch (err) {
    return NextResponse.json({ queries: [], subreddits: [], error: String(err) })
  }
}

function getFallback(activities: string[], baseCity: string, country: string): string[] {
  const q = [`${country} hidden gem reddit`, `${baseCity} local tips`, `visit ${country} advice`]
  if ((activities || []).includes('sup')) q.push(`${baseCity} SUP kayak lake`)
  if ((activities || []).includes('trekking')) q.push(`${country} hiking trail recommend`)
  if ((activities || []).includes('food')) q.push(`${baseCity} local restaurant`)
  if ((activities || []).includes('nightlife')) q.push(`${baseCity} bar nightlife`)
  return q
}
