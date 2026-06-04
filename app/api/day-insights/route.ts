import { NextRequest, NextResponse } from 'next/server'
import { searchWeb, isSearchConfigured } from '@/lib/searchProvider'

export const maxDuration = 60

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY

// ——— Typy wejścia/wyjścia ———
type StopIn = { name: string; lat: number | null; lon: number | null; openingLine?: string | null; durationMin?: number | null }
type LegIn = { distanceText: string; durationMin: number }
type WeatherIn = { tempMax: number; tempMin: number; precipitation: number; weatherCode: number } | null

type ParkingSpot = { name: string; vicinity: string; distanceM: number | null }
type DayParking = { stop: string; spots: ParkingSpot[] }

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)))
}

// Najbliższe parkingi wokół przystanku (Google Nearby, rankby=distance).
async function nearbyParking(stop: StopIn): Promise<ParkingSpot[]> {
  if (!GOOGLE_API_KEY || stop.lat == null || stop.lon == null) return []
  try {
    const url =
      `https://maps.googleapis.com/maps/api/place/nearbysearch/json` +
      `?location=${stop.lat},${stop.lon}&rankby=distance&type=parking&key=${GOOGLE_API_KEY}&language=pl`
    const res = await fetch(url)
    if (!res.ok) return []
    const data = await res.json()
    const results: any[] = Array.isArray(data?.results) ? data.results : []
    return results.slice(0, 2).map((r): ParkingSpot => {
      const loc = r?.geometry?.location
      const distanceM =
        loc && typeof loc.lat === 'number' ? haversineM(stop.lat as number, stop.lon as number, loc.lat, loc.lng) : null
      return {
        name: String(r?.name || 'Parking').trim(),
        vicinity: String(r?.vicinity || '').trim(),
        distanceM,
      }
    })
  } catch {
    return []
  }
}

// Lokalne tipy parkingowe z Brave (best-effort).
async function parkingTips(stop: StopIn, cityHint: string): Promise<string[]> {
  if (!isSearchConfigured()) return []
  const q = `gdzie zaparkować ${stop.name}${cityHint ? ' ' + cityHint : ''} parking tips`
  const results = await searchWeb(q, 3)
  return results.map((r) => `${r.title}: ${r.snippet}`).filter(Boolean).slice(0, 3)
}

// ——— DeepSeek ———
async function callDeepSeek(prompt: string, maxTokens: number) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 45000)
  try {
    return await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'Jesteś doświadczonym organizatorem wypraw i lokalnym przewodnikiem. Zwracasz wyłącznie jeden poprawny obiekt JSON. Wszystkie teksty po polsku, zwięźle, konkretnie, praktycznie. Nie zmyślasz nazw — gdy nie masz pewności, pisz ogólnie.',
          },
          { role: 'user', content: prompt },
        ],
      }),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw)
  } catch {
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try { return JSON.parse(raw.slice(start, end + 1)) } catch { return null }
    }
    return null
  }
}

export async function POST(request: NextRequest) {
  let body: any
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }

  const stops: StopIn[] = Array.isArray(body?.stops) ? body.stops : []
  const legs: LegIn[] = Array.isArray(body?.legs) ? body.legs : []
  const weather: WeatherIn = body?.weather || null
  const activities: string[] = Array.isArray(body?.activities) ? body.activities : []
  const date: string = typeof body?.date === 'string' ? body.date : ''
  const cityHint: string = typeof body?.cityHint === 'string' ? body.cityHint : ''

  if (stops.length === 0) {
    return NextResponse.json({ briefing: null, parking: [], generatedAt: new Date().toISOString() })
  }

  // Parking (Google) + tipy (Brave) równolegle, dla maks. 5 przystanków.
  const capped = stops.slice(0, 5)
  const [parkingPerStop, tipsPerStop] = await Promise.all([
    Promise.all(capped.map((s) => nearbyParking(s))),
    Promise.all(capped.map((s) => parkingTips(s, cityHint))),
  ])

  const parking: DayParking[] = capped.map((s, i) => ({ stop: s.name, spots: parkingPerStop[i] || [] }))

  // Kontekst do DeepSeek.
  const stopsCtx = stops
    .map((s, i) => {
      const open = s.openingLine ? ` | godziny: ${s.openingLine}` : ''
      const dur = s.durationMin ? ` | plan pobytu: ${s.durationMin} min` : ''
      const pk = parking[i]?.spots?.length
        ? ` | parkingi w pobliżu: ${parking[i].spots.map((p) => `${p.name}${p.distanceM != null ? ` (${p.distanceM} m)` : ''}`).join(', ')}`
        : ''
      const tips = tipsPerStop[i]?.length ? ` | znalezione w sieci: ${tipsPerStop[i].join(' || ')}` : ''
      return `${i + 1}. ${s.name}${open}${dur}${pk}${tips}`
    })
    .join('\n')

  const legsCtx = legs.length
    ? legs.map((l, i) => `Odcinek ${i + 1}→${i + 2}: ${l.distanceText}, ~${l.durationMin} min jazdy`).join('\n')
    : 'brak przejazdów (jeden przystanek lub brak danych)'

  const weatherCtx = weather
    ? `Pogoda: maks ${weather.tempMax}°C, min ${weather.tempMin}°C, opady ${weather.precipitation} mm`
    : 'Pogoda: brak danych'

  const prompt = `Zaplanuj jeden dzień wyprawy. Data: ${date || 'nieznana'}.
Aktywności preferowane przez ekipę: ${activities.length ? activities.join(', ') : 'różne'}.

Przystanki (w obecnej kolejności):
${stopsCtx}

Przejazdy:
${legsCtx}

${weatherCtx}

Zwróć obiekt JSON o polach:
{
  "summary": "1-2 zdania, charakter dnia",
  "timing": "rekomendacja kolejności i godzin startu — uwzględnij godziny otwarcia i czasy jazdy",
  "feasibility": "czy plan jest realny czasowo; jeśli coś się nie spina lub miejsce zamyka się wcześniej, napisz to wprost i zaproponuj poprawkę",
  "stops": [{ "name": "dokładna nazwa przystanku", "tip": "co warto wiedzieć / na co uważać", "parking": "gdzie zaparkować — użyj realnych nazw parkingów z kontekstu jeśli są; możesz dodać tip ze znalezionych w sieci; nie zmyślaj nazw" }],
  "weather": "krótka uwaga pogodowa wpływająca na plan, albo null"
}
Pole "stops" musi mieć wpis dla każdego przystanku, w tej samej kolejności.`

  let briefing = null
  if (process.env.DEEPSEEK_API_KEY) {
    try {
      const res = await callDeepSeek(prompt, 1300)
      if (res.ok) {
        const data = await res.json()
        const raw = data?.choices?.[0]?.message?.content || ''
        const parsed = parseJsonObject(raw)
        if (parsed) {
          briefing = {
            summary: String(parsed.summary || ''),
            timing: String(parsed.timing || ''),
            feasibility: String(parsed.feasibility || ''),
            stops: Array.isArray(parsed.stops)
              ? (parsed.stops as any[]).map((s) => ({
                  name: String(s?.name || ''),
                  tip: String(s?.tip || ''),
                  parking: String(s?.parking || ''),
                }))
              : [],
            weather: parsed.weather ? String(parsed.weather) : null,
          }
        }
      }
    } catch {
      briefing = null
    }
  }

  return NextResponse.json({ briefing, parking, generatedAt: new Date().toISOString() })
}
