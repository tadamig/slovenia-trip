import { NextRequest, NextResponse } from 'next/server'

// Mapowanie region → kraj w języku angielskim
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

function getCountry(region: string, baseCity: string): string {
  return REGION_TO_COUNTRY[region.toLowerCase()] || baseCity
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      activities,
      baseCity,
      region,
      transport,
      accommodation,
      intensity,
      numPeople,
      budget,
      food,
      tripDays,
      month,
    } = body

    if (!baseCity || !region) {
      return NextResponse.json({ error: 'Missing required fields: baseCity, region' }, { status: 400 })
    }

    const country = getCountry(region, baseCity)

    const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
    const monthName = month ? MONTH_NAMES[month - 1] : 'summer'

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
- Destination/base: ${baseCity}, ${country}
- Activities wanted: ${activities.join(', ') || 'general sightseeing'}
- Travel pace: ${intensityMap[intensity] || 'balanced'}
- Transport: ${transportMap[transport] || 'car'}
- Accommodation: ${accommodationMap[accommodation] || 'various'}
- Group size: ${numPeople || 4} people
- Trip duration: ${tripDays ? `${tripDays} days` : 'unknown'}
- Month of travel: ${monthName}
- Budget: ${budgetMap[budget] || 'any'}
- ${foodContext}

RULES for queries:
- Mix broad country queries ("${country} hidden gem") with specific city queries ("${baseCity} local tip")
- Include seasonal context where relevant (${monthName} activities in ${country})
- Include budget context if budget matters
- Focus on authentic, local, off-beaten-path experiences
- Include queries that locals would write, not tourist brochure language
- Do NOT use quotation marks in queries
- Each query should be 3-6 words max

Return ONLY a JSON object, no explanation:
{
  "queries": ["query 1", "query 2", ...],
  "subreddits": ["Slovenia", "travel", "hiking", ...]
}

For subreddits: return 15-20 relevant subreddit names (without r/ prefix) for this specific trip. Mix country-specific, activity-specific, and travel subreddits.`

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
          { role: 'system', content: 'You generate Reddit search queries. Return ONLY a JSON object with queries and subreddits fields, no explanation, no markdown.' },
          { role: 'user', content: prompt },
        ],
      }),
    })

    if (!res.ok) {
      return NextResponse.json({ queries: getFallbackQueries(activities || [], baseCity, country), subreddits: [] })
    }

    const data = await res.json()
    const raw = data.choices?.[0]?.message?.content || '{}'

    let queries: string[] = []
    let subreddits: string[] = []
    try {
      const clean = raw.replace(/```json|```/g, '').trim()
      const parsed = JSON.parse(clean)
      if (Array.isArray(parsed)) {
        queries = parsed
      } else {
        queries = parsed.queries || []
        subreddits = parsed.subreddits || []
      }
    } catch {
      queries = getFallbackQueries(activities || [], baseCity, country)
    }

    return NextResponse.json({ queries: queries.slice(0, 20), subreddits })
  } catch (err) {
    return NextResponse.json({ queries: [], subreddits: [], error: String(err) })
  }
}

function getFallbackQueries(activities: string[], baseCity: string, country: string): string[] {
  const base: string[] = [
    `${country} hidden gem travel`,
    `${baseCity} local tips reddit`,
    `${country} travel recommend`,
    `visit ${country} advice`,
    `${baseCity} what to do`,
    `${country} off beaten path`,
  ]
  if (activities.includes('sup')) base.push(`${country} SUP kayak lake`, `${baseCity} water activities`)
  if (activities.includes('trekking')) base.push(`${country} hiking trail`, `${baseCity} hiking day trip`)
  if (activities.includes('food')) base.push(`${baseCity} local restaurant`, `${country} food must try`)
  if (activities.includes('cycling')) base.push(`${country} cycling route`, `${baseCity} bike trail`)
  if (activities.includes('relax')) base.push(`${country} thermal spa`, `${baseCity} relaxing spot`)
  if (activities.includes('nightlife')) base.push(`${baseCity} bar nightlife`, `${baseCity} craft beer`)
  if (activities.includes('photo')) base.push(`${country} photography spot`, `${baseCity} viewpoint`)
  return base
}
