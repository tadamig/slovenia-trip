import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      activities = [],
      baseCity = 'Ljubljana',
      region = 'slovenia',
      transport,
      accommodation,
      intensity,
      numPeople,
      budget,
      food = [],
      tripDays,
      month,
    } = body

    const MONTH_NAMES = ['stycznia','lutego','marca','kwietnia','maja','czerwca','lipca','sierpnia','września','października','listopada','grudnia']
    const monthName = month ? MONTH_NAMES[month - 1] : null

    const transportMap: Record<string, string> = {
      van: 'van/campervan', own_car: 'own car', rental: 'rental car', motorcycle: 'motorcycle'
    }
    const accommodationMap: Record<string, string> = {
      tent: 'camping/tent', van: 'van/campervan', airbnb: 'Airbnb/apartment', hotel: 'hotel/hostel'
    }
    const intensityMap: Record<string, string> = {
      slow: 'slow and relaxed', balanced: 'balanced mix', intense: 'action-packed and intense'
    }
    const budgetMap: Record<string, string> = {
      budget: 'budget-friendly (street food, cheap eats, free attractions)',
      mid: 'mid-range (local restaurants, reasonable prices)',
      any: 'budget is not a concern',
    }

    const foodContext = food.length > 0 && !food.includes('anything')
      ? `Dietary preferences: ${food.join(', ')}.`
      : 'No dietary restrictions.'

    const prompt = `You are an expert travel query generator. Generate exactly 20 Reddit search queries for a trip based on this traveler profile.

TRIP PROFILE:
- Destination/base: ${baseCity}, ${region === 'budapest' ? 'Hungary' : 'Slovenia'}
- Activities wanted: ${activities.join(', ') || 'general sightseeing'}
- Travel pace: ${intensityMap[intensity] || 'balanced'}
- Transport: ${transportMap[transport] || 'car'}
- Accommodation: ${accommodationMap[accommodation] || 'various'}
- Group size: ${numPeople || 4} people
- Trip duration: ${tripDays ? `${tripDays} days` : 'unknown'}
- Month of travel: ${monthName || 'summer'}
- Budget: ${budgetMap[budget] || 'any'}
- ${foodContext}

RULES for queries:
- Mix broad country queries ("Slovenia hidden gem") with specific city queries ("${baseCity} local tip")
- Include seasonal context where relevant (${monthName || 'summer'} activities)
- Include budget context if budget matters (budget=${budget})
- Focus on authentic, local, off-beaten-path experiences
- Include queries that locals would write, not tourist brochure language
- Vary subreddits context: travel, solotravel, hiking, kayaking, food, etc.
- Do NOT use quotation marks in queries
- Each query should be 3-6 words max

Return ONLY a JSON array of 20 strings, nothing else:
["query 1", "query 2", ...]`

    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        max_tokens: 800,
        messages: [
          { role: 'system', content: 'You generate Reddit search queries. Return ONLY a JSON array of strings, no explanation.' },
          { role: 'user', content: prompt },
        ],
      }),
    })

    if (!res.ok) {
      return NextResponse.json({ queries: getFallbackQueries(activities, baseCity, region) })
    }

    const data = await res.json()
    const raw = data.choices?.[0]?.message?.content || '[]'

    let queries: string[] = []
    try {
      const clean = raw.replace(/```json|```/g, '').trim()
      queries = JSON.parse(clean)
      if (!Array.isArray(queries)) queries = []
    } catch {
      queries = getFallbackQueries(activities, baseCity, region)
    }

    return NextResponse.json({ queries: queries.slice(0, 20) })
  } catch (err) {
    return NextResponse.json({ queries: [], error: String(err) })
  }
}

function getFallbackQueries(activities: string[], baseCity: string, region: string): string[] {
  const country = region === 'budapest' ? 'Hungary Budapest' : 'Slovenia'
  const base: string[] = [
    `${country} hidden gem travel`,
    `${baseCity} local tips reddit`,
    `${country} travel recommend`,
    `visit ${country} advice`,
  ]
  if (activities.includes('sup')) base.push(`${country} SUP kayak lake`, `${baseCity} water activities`)
  if (activities.includes('trekking')) base.push(`${country} hiking trail`, `${baseCity} hiking day trip`)
  if (activities.includes('food')) base.push(`${baseCity} local restaurant`, `${country} food must try`)
  return base
}
