import { NextRequest, NextResponse } from 'next/server'

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY

// Granice geograficzne regionów
const REGION_BOUNDS: Record<string, { minLat: number; maxLat: number; minLon: number; maxLon: number }> = {
  slovenia: { minLat: 45.4, maxLat: 46.9, minLon: 13.3, maxLon: 16.6 },
  budapest: { minLat: 46.8, maxLat: 48.7, minLon: 16.0, maxLon: 23.0 },
}

function isInRegion(lat: number, lon: number, region: string): boolean {
  const bounds = REGION_BOUNDS[region] || REGION_BOUNDS.slovenia
  return lat >= bounds.minLat && lat <= bounds.maxLat && lon >= bounds.minLon && lon <= bounds.maxLon
}

interface PlaceToVerify {
  name: string
  region: string
  country?: string
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
  types?: string[]
}

async function verifyWithGoogle(place: PlaceToVerify): Promise<VerifiedPlace> {
  if (!GOOGLE_API_KEY) {
    return { name: place.name, verified: false, reason: 'no_api_key' }
  }

  try {
    const country = place.region === 'budapest' ? 'Hungary' : 'Slovenia'
    const query = `${place.name} ${country}`
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${GOOGLE_API_KEY}&language=en`

    const res = await fetch(url)
    if (!res.ok) return { name: place.name, verified: false, reason: `google_error_${res.status}` }

    const data = await res.json()

    if (data.status !== 'OK' || !data.results?.length) {
      return { name: place.name, verified: false, reason: `not_found_${data.status}` }
    }

    const result = data.results[0]
    const lat = result.geometry?.location?.lat
    const lon = result.geometry?.location?.lng

    // Weryfikacja przez współrzędne geograficzne — niezawodna
    if (!lat || !lon) return { name: place.name, verified: false, reason: 'no_coordinates' }

    const inRegion = isInRegion(lat, lon, place.region)
    if (!inRegion) return { name: place.name, verified: false, reason: `out_of_region_lat${lat?.toFixed(2)}_lon${lon?.toFixed(2)}_addr:${result.formatted_address}` }

    // Pobierz szczegóły: status otwarcia
    let isOpen: boolean | null = null
    if (result.place_id) {
      try {
        const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${result.place_id}&fields=opening_hours&key=${GOOGLE_API_KEY}`
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
      googlePlaceId: result.place_id,
      lat,
      lon,
      rating: result.rating,
      totalRatings: result.user_ratings_total,
      isOpen,
      address: result.formatted_address,
      types: result.types?.slice(0, 3),
    }
  } catch {
    return { name: place.name, verified: false }
  }
}

export async function POST(request: NextRequest) {
  try {
    const { places } = await request.json()
    if (!places?.length) return NextResponse.json({ verified: [] })

    // Weryfikuj równolegle
    const results = await Promise.all(places.map(verifyWithGoogle))
    return NextResponse.json({ verified: results })
  } catch (err) {
    return NextResponse.json({ verified: [], error: String(err) })
  }
}
