import { NextRequest, NextResponse } from 'next/server'

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY

// Haversine — odległość w km między dwoma punktami
function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat/2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// Mapowanie Google types na nasze tagi
function googleTypesToTags(types: string[]): string[] {
  const tags: string[] = []
  const typeSet = types
  const t = { has: (v: string) => typeSet.includes(v) }
  if (t.has('restaurant') || t.has('cafe') || t.has('bakery') || t.has('bar') || t.has('food')) tags.push('food')
  if (t.has('night_club') || t.has('bar')) tags.push('nightlife')
  if (t.has('museum') || t.has('tourist_attraction') || t.has('church') || t.has('art_gallery')) tags.push('sightseeing')
  if (t.has('park') || t.has('natural_feature') || t.has('campground')) tags.push('trekking')
  if (t.has('spa')) tags.push('relax')
  if (t.has('locality') || t.has('neighborhood') || t.has('political')) tags.push('sightseeing')
  if (tags.length === 0) tags.push('sightseeing') // fallback
  return Array.from(new Set(tags))
}

async function searchGooglePlaces(query: string, lat: number, lon: number, radius: number): Promise<any[]> {
  if (!GOOGLE_API_KEY) return []

  try {
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&location=${lat},${lon}&radius=${radius * 1000}&key=${GOOGLE_API_KEY}&language=en`
    const res = await fetch(url)
    if (!res.ok) return []
    const data = await res.json()
    return data.results || []
  } catch {
    return []
  }
}

async function geocodeCity(city: string, country: string): Promise<{ lat: number; lon: number } | null> {
  if (!GOOGLE_API_KEY) return null
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(`${city}, ${country}`)}&key=${GOOGLE_API_KEY}`
    const res = await fetch(url)
    if (!res.ok) return null
    const data = await res.json()
    const loc = data.results?.[0]?.geometry?.location
    if (!loc) return null
    return { lat: loc.lat, lon: loc.lng }
  } catch {
    return null
  }
}

async function getPlaceDetails(placeId: string): Promise<any> {
  if (!GOOGLE_API_KEY) return {}
  try {
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=opening_hours,price_level,formatted_phone_number,website&key=${GOOGLE_API_KEY}`
    const res = await fetch(url)
    if (!res.ok) return {}
    const data = await res.json()
    return data.result || {}
  } catch {
    return {}
  }
}

export async function POST(request: NextRequest) {
  try {
    const { queries = [], baseCity, country, baseLat, baseLon, radius = 50 } = await request.json()

    if (!queries.length) return NextResponse.json({ places: [] })
    if (!GOOGLE_API_KEY) return NextResponse.json({ places: [], error: 'No API key' })

    // Geocoduj bazę jeśli nie ma koordynatów
    let lat = baseLat
    let lon = baseLon
    if (!lat || !lon) {
      const coords = await geocodeCity(baseCity, country)
      if (coords) { lat = coords.lat; lon = coords.lon }
      else return NextResponse.json({ places: [] })
    }

    // Szukaj równolegle dla wszystkich zapytań
    const allResults = await Promise.all(
      queries.map((q: string) => searchGooglePlaces(q, lat, lon, radius))
    )

    // Deduplikuj po placeId i zbierz
    const seenIds = new Set<string>()
    const places: any[] = []

    for (const results of allResults) {
      for (const r of results) {
        if (!r.place_id || seenIds.has(r.place_id)) continue
        seenIds.add(r.place_id)

        const placeLat = r.geometry?.location?.lat
        const placeLon = r.geometry?.location?.lng
        if (!placeLat || !placeLon) continue

        const distance = Math.round(distanceKm(lat, lon, placeLat, placeLon))
        if (distance > radius * 1.5) continue // odrzuć zbyt odległe

        places.push({
          name: r.name,
          googlePlaceId: r.place_id,
          lat: placeLat,
          lon: placeLon,
          rating: r.rating,
          totalRatings: r.user_ratings_total,
          address: r.formatted_address,
          types: r.types || [],
          tags: googleTypesToTags(r.types || []),
          distanceFromBase: distance,
          priceLevel: r.price_level,
          verified: true,
          source: 'google',
          isOpen: r.opening_hours?.open_now ?? null,
        })
      }
    }

    // Posortuj po odległości
    places.sort((a, b) => a.distanceFromBase - b.distanceFromBase)

    // Pobierz szczegóły dla pierwszych 15 (godziny, strona, telefon)
    const top = places.slice(0, 15)
    await Promise.all(top.map(async (p) => {
      const details = await getPlaceDetails(p.googlePlaceId)
      if (details.opening_hours?.open_now !== undefined) p.isOpen = details.opening_hours.open_now
      if (details.price_level !== undefined) p.priceLevel = details.price_level
      if (details.website) p.website = details.website
    }))

    return NextResponse.json({ places, baseLat: lat, baseLon: lon })
  } catch (err) {
    return NextResponse.json({ places: [], error: String(err) })
  }
}
