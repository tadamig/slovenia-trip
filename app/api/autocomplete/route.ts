import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const input = request.nextUrl.searchParams.get('input')
  if (!input || input.length < 2) {
    return NextResponse.json({ predictions: [] })
  }

  const key = process.env.GOOGLE_PLACES_API_KEY
  if (!key) {
    return NextResponse.json({ predictions: [] })
  }

  try {
    const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(input)}&types=(cities)&language=en&key=${key}`
    const res = await fetch(url)
    if (!res.ok) return NextResponse.json({ predictions: [] })

    const data = await res.json()

    const predictions = (data.predictions || []).map((p: any) => ({
      placeId: p.place_id,
      description: p.description,
      mainText: p.structured_formatting?.main_text || p.description,
      secondaryText: p.structured_formatting?.secondary_text || '',
    }))

    return NextResponse.json({ predictions })
  } catch {
    return NextResponse.json({ predictions: [] })
  }
}
