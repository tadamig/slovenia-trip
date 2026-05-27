import { NextRequest, NextResponse } from 'next/server'

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY

const REGION_BOUNDS: Record<string, { minLat: number; maxLat: number; minLon: number; maxLon: number }> = {
  slovenia: { minLat: 45.4, maxLat: 46.9, minLon: 13.3, maxLon: 16.6 },
  budapest: { minLat: 46.8, maxLat: 48.7, minLon: 16.0, maxLon: 23.0 },
}

function isInRegion(lat: number, lon: number, region: string): boolean {
  const bounds = REGION_BOUNDS[region] || REGION_BOUNDS.slovenia
  return lat >= bounds.minLat && lat <= bounds.maxLat && lon >= bounds.minLon && lon <= bounds.maxLon
}

// Fuzzy matching nazw — zwraca 0-1
function nameSimilarity(a: string, b: string): number {
  const normalize = (s: string) => s.toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  const na = normalize(a)
  const nb = normalize(b)

  if (na === nb) return 1.0
  if (na.includes(nb) || nb.includes(na)) return 0.9

  // Wspólne słowa
  const wordsA = na.split(' ').filter(w => w.length > 2)
  const wordsB = nb.split(' ').filter(w => w.length > 2)
  if (wordsA.length === 0 || wordsB.length === 0) return 0

  const common = wordsA.filter(w => wordsB.some(wb => wb.includes(w) || w.includes(wb)))
  return common.length / Math.max(wordsA.length, wordsB.length)
}

interface PlaceToVerify {
  name: string
  region: string
  subregion?: string
  country?: string
  lat?: number
  lon?: number
}

interface VerifiedPlace {
  name: string
  verified: boolean
  reason?: string
  googlePlaceId?: string
  lat?: number
  lon?: number
  rating?: number
  totalRatings?: number
  isOpen?: boolean | null
  address?: string
  similarity?: number
}

async function verifyWithGoogle(place: PlaceToVerify): Promise<VerifiedPlace> {
  if (!GOOGLE_API_KEY) {
    return { name: place.name, verified: false, reason: 'no_api_key' }
  }

  try {
    const country = place.region === 'budapest' ? 'Hungary' : 'Slovenia'
    // Użyj subregion jeśli dostępny dla bardziej precyzyjnego szukania
    const location = place.subregion || country
    const query = `${place.name} ${location}`

    // Dodaj location bias jeśli mamy koordynaty od DeepSeek
    const locationBias = place.lat && place.lon
      ? `&location=${place.lat},${place.lon}&radius=10000`
      : ''

    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${GOOGLE_API_KEY}&language=en${locationBias}`

    const res = await fetch(url)
    if (!res.ok) return { name: place.name, verified: false, reason: `google_error_${res.status}` }

    const data = await res.json()
    if (data.status !== 'OK' || !data.results?.length) {
      return { name: place.name, verified: false, reason: `not_found_${data.status}` }
    }

    // Sprawdź wszystkich kandydatów (max 5) i wybierz najlepiej pasującego
    const candidates = data.results.slice(0, 5)
    let bestMatch: any = null
    let bestSimilarity = 0

    for (const candidate of candidates) {
      const lat = candidate.geometry?.location?.lat
      const lon = candidate.geometry?.location?.lng

      if (!lat || !lon) continue
      if (!isInRegion(lat, lon, place.region)) continue

      const similarity = nameSimilarity(place.name, candidate.name)
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity
        bestMatch = candidate
      }
    }

    // Wymaga >70% podobieństwa nazwy
    if (!bestMatch || bestSimilarity < 0.7) {
      return {
        name: place.name,
        verified: false,
        reason: `low_similarity_${bestSimilarity.toFixed(2)}_best:${bestMatch?.name || 'none'}`,
      }
    }

    const lat = bestMatch.geometry.location.lat
    const lon = bestMatch.geometry.location.lng

    // Pobierz status otwarcia
    let isOpen: boolean | null = null
    if (bestMatch.place_id) {
      try {
        const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${bestMatch.place_id}&fields=opening_hours&key=${GOOGLE_API_KEY}`
        const detailRes = await fetch(detailUrl)
        if (detailRes.ok) {
          const detailData = await detailRes.json()
          if (detailData.result?.opening_hours?.open_now !== undefined) {
            isOpen = detailData.result.opening_hours.open_now
          }
        }
      } catch {}
    }

    return {
      name: place.name,
      verified: true,
      reason: `ok_similarity_${bestSimilarity.toFixed(2)}`,
      googlePlaceId: bestMatch.place_id,
      lat,
      lon,
      rating: bestMatch.rating,
      totalRatings: bestMatch.user_ratings_total,
      isOpen,
      address: bestMatch.formatted_address,
      similarity: bestSimilarity,
    }
  } catch (e) {
    return { name: place.name, verified: false, reason: `exception_${String(e).slice(0, 50)}` }
  }
}

export async function POST(request: NextRequest) {
  try {
    const { places } = await request.json()
    if (!places?.length) return NextResponse.json({ verified: [] })

    const results = await Promise.all(places.map(verifyWithGoogle))
    return NextResponse.json({ verified: results })
  } catch (err) {
    return NextResponse.json({ verified: [], error: String(err) })
  }
}
