import { NextRequest, NextResponse } from 'next/server'

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY

interface PlaceToVerify {
  name: string
  region: string
  country?: string
  lat?: number
  lon?: number
}

interface VerifiedPlace {
  name: string
  verified: boolean
  googlePlaceId?: string
  lat?: number
  lon?: number
  rating?: number
  totalRatings?: number
  isOpen?: boolean | null
  address?: string
  photoRef?: string
  types?: string[]
}

async function verifyWithGoogle(place: PlaceToVerify): Promise<VerifiedPlace> {
  if (!GOOGLE_API_KEY) {
    return { name: place.name, verified: false }
  }

  try {
    // Text search — szukamy po nazwie + regionie
    const query = `${place.name} ${place.country || place.region}`
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${GOOGLE_API_KEY}&language=pl`

    const res = await fetch(url)
    if (!res.ok) return { name: place.name, verified: false }

    const data = await res.json()
    if (data.status !== 'OK' || !data.results?.length) {
      return { name: place.name, verified: false }
    }

    const result = data.results[0]

    // Sprawdź czy wynik jest w odpowiednim regionie (Słowenia / Węgry)
    const addressLower = (result.formatted_address || '').toLowerCase()
    const regionKeywords = place.region === 'budapest'
      ? ['hungary', 'węgry', 'budapest', 'magyarország']
      : ['slovenia', 'słowenia', 'slovenija']

    const inRegion = regionKeywords.some(k => addressLower.includes(k))

    // Pobierz szczegóły żeby dostać status otwarcia
    let isOpen: boolean | null = null
    if (result.place_id) {
      try {
        const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${result.place_id}&fields=opening_hours,rating,user_ratings_total&key=${GOOGLE_API_KEY}`
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
      verified: inRegion,
      googlePlaceId: result.place_id,
      lat: result.geometry?.location?.lat,
      lon: result.geometry?.location?.lng,
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

    // Weryfikuj równolegle (max 5 naraz żeby nie przekroczyć limitów)
    const results: VerifiedPlace[] = []
    for (let i = 0; i < places.length; i += 5) {
      const batch = places.slice(i, i + 5)
      const batchResults = await Promise.all(batch.map(verifyWithGoogle))
      results.push(...batchResults)
    }

    return NextResponse.json({ verified: results })
  } catch (err) {
    return NextResponse.json({ verified: [], error: String(err) })
  }
}
