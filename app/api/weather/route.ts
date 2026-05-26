import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 30

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const lat = searchParams.get('lat')
  const lon = searchParams.get('lon')

  if (!lat || !lon) {
    return NextResponse.json({ error: 'Missing lat/lon' }, { status: 400 })
  }

  // Ogranicz daty do max 14 dni od dziś
  const now = new Date()
  const maxDate = new Date()
  maxDate.setDate(now.getDate() + 14)
  const fmt = (d: Date) => d.toISOString().split('T')[0]

  let startDate = searchParams.get('start_date')
  let endDate = searchParams.get('end_date')

  // Jeśli start jest za daleko — użyj dziś
  if (startDate && new Date(startDate) > maxDate) {
    startDate = fmt(now)
  }

  // Jeśli end jest za daleko — przytnij do maxDate
  if (endDate && new Date(endDate) > maxDate) {
    endDate = fmt(maxDate)
  }

  // Domyślnie — od dziś przez 7 dni
  if (!startDate) startDate = fmt(now)
  if (!endDate) {
    const def = new Date(now)
    def.setDate(now.getDate() + 7)
    endDate = fmt(def < maxDate ? def : maxDate)
  }

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,weather_code&timezone=Europe%2FWarsaw&start_date=${startDate}&end_date=${endDate}`

  try {
    const res = await fetch(url, { next: { revalidate: 3600 } })
    if (!res.ok) {
      const text = await res.text()
      return NextResponse.json({ error: `API error ${res.status}: ${text}` }, { status: res.status })
    }
    const data = await res.json()
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
