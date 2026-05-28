import { NextRequest, NextResponse } from 'next/server'

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY

const REGION_BOUNDS: Record<string, { minLat: number; maxLat: number; minLon: number; maxLon: number }> = {
  slovenia:  { minLat: 45.4, maxLat: 46.9, minLon: 13.3, maxLon: 16.6 },
  budapest:  { minLat: 46.8, maxLat: 48.7, minLon: 16.0, maxLon: 23.0 },
  croatia:   { minLat: 42.3, maxLat: 46.6, minLon: 13.4, maxLon: 19.5 },
  austria:   { minLat: 46.3, maxLat: 49.1, minLon: 9.5,  maxLon: 17.2 },
  italy:     { minLat: 36.5, maxLat: 47.1, minLon: 6.6,  maxLon: 18.6 },
  europe:    { minLat: 34.0, maxLat: 72.0, minLon: -25.0, maxLon: 45.0 },
}

function isInRegion(lat: number, lon: number, region: string): boolean {
  const bounds = REGION_BOUNDS[region.toLowerCase()] || REGION_BOUNDS.europe
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

  // Wspólne słowa — uwzględnij też słowa krótkie (min 2 litery)
  const wordsA = na.split(' ').filter(w => w.length > 1)
  const wordsB = nb.split(' ').filter(w => w.length > 1)
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
  tags?: string[]
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

// Wyciąga kluczową nazwę własną z opisowej nazwy
function extractKeyName(name: string): string {
  // Usuń część przed "–" lub " - " (często lokalizacja/opis po polsku)
  const dashParts = name.split(/\s*[–-]\s*/)
  let key = dashParts.length > 1 ? dashParts[dashParts.length - 1] : name

  // Usuń polskie słowa opisowe
  const polishWords = ['willa', 'ogrody', 'ogród', 'miasto', 'perła', 'baza', 'trasy', 'wędrówki',
    'jezioro', 'nad', 'jeziorem', 'wschodnim', 'ramieniem', 'zachodnim', 'centrum',
    'stare', 'starego', 'centrum', 'okolice', 'okolica', 'szlaki', 'szlak',
    'widok', 'widoki', 'dolina', 'góry', 'park', 'rezerwat', 'zabytki', 'zabytek',
    'muzeum', 'kościół', 'zamek', 'most', 'plac', 'ulica', 'dzielnica']

  const words = key.split(' ')
  const filtered = words.filter(w => !polishWords.includes(w.toLowerCase()))
  key = filtered.length >= 2 ? filtered.join(' ') : key // zostaw oryginał jeśli za krótko

  return key.trim()
}

// Mapowanie tagów DeepSeek na Google Place types
const TAG_TO_GOOGLE_TYPES: Record<string, string[]> = {
  food: ['restaurant', 'cafe', 'bar', 'bakery', 'meal_takeaway', 'food', 'establishment'],
  sightseeing: ['tourist_attraction', 'museum', 'church', 'place_of_worship', 'art_gallery', 'historic_site', 'point_of_interest'],
  relax: ['spa', 'park', 'natural_feature', 'campground', 'lodging', 'tourist_attraction'],
  trekking: ['natural_feature', 'park', 'campground', 'tourist_attraction', 'point_of_interest'],
  sup: ['natural_feature', 'park', 'tourist_attraction', 'campground'],
  cycling: ['park', 'natural_feature', 'tourist_attraction', 'point_of_interest'],
  nightlife: ['bar', 'night_club', 'restaurant', 'establishment'],
  markets: ['store', 'shopping_mall', 'market', 'establishment', 'food'],
  photo: ['tourist_attraction', 'natural_feature', 'park', 'point_of_interest'],
  sunset: ['natural_feature', 'park', 'tourist_attraction', 'point_of_interest'],
}

function typeMatchesTags(googleTypes: string[], tags: string[]): boolean {
  if (!tags?.length || !googleTypes?.length) return true // brak danych = przepuszczamy
  const allowedTypes = new Set(tags.flatMap(tag => TAG_TO_GOOGLE_TYPES[tag] || []))
  if (allowedTypes.size === 0) return true
  return googleTypes.some(t => allowedTypes.has(t))
}

async function verifyWithGoogle(place: PlaceToVerify): Promise<VerifiedPlace> {
  if (!GOOGLE_API_KEY) {
    return { name: place.name, verified: false, reason: 'no_api_key' }
  }

  try {
    const REGION_TO_COUNTRY: Record<string, string> = {
      slovenia: 'Slovenia', budapest: 'Hungary', croatia: 'Croatia',
      austria: 'Austria', italy: 'Italy', czechia: 'Czech Republic', europe: '',
    }
    const country = place.country || REGION_TO_COUNTRY[place.region] || place.region
    const COUNTRY_TO_REGION: Record<string, string> = {
      'slovenia': 'slovenia', 'hungary': 'budapest', 'croatia': 'croatia',
      'austria': 'austria', 'italy': 'italy', 'czech republic': 'czechia',
    }
    const detectedRegion = COUNTRY_TO_REGION[country.toLowerCase()] || 'europe'

    // Wyciągnij kluczową nazwę własną + użyj subregion jako kontekst
    const keyName = extractKeyName(place.name)
    const location = place.subregion || country
    const query = `${keyName} ${location}`

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
      if (!isInRegion(lat, lon, detectedRegion)) continue

      const keyN = extractKeyName(place.name)
      const similarity = Math.max(nameSimilarity(place.name, candidate.name), nameSimilarity(keyN, candidate.name))
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity
        bestMatch = candidate
      }
    }

    // Wymaga >70% podobieństwa nazwy
    if (!bestMatch || bestSimilarity < 0.50) {
      const debugCandidates = candidates.slice(0, 2).map((c: any) => {
        const clat = c.geometry?.location?.lat
        const clon = c.geometry?.location?.lng
        const inR = clat && clon ? isInRegion(clat, clon, detectedRegion) : 'nocoords'
        return `${c.name}(${clat?.toFixed(1)},${clon?.toFixed(1)},inRegion:${inR})`
      }).join('|')
      return {
        name: place.name,
        verified: false,
        reason: `low_sim_${bestSimilarity.toFixed(2)}_region:${detectedRegion}_country:${country}_candidates:${debugCandidates}`,
      }
    }

    const lat = bestMatch.geometry.location.lat
    const lon = bestMatch.geometry.location.lng

    // Sprawdź czy typ miejsca pasuje do tagów
    if (place.tags?.length && !typeMatchesTags(bestMatch.types || [], place.tags)) {
      return {
        name: place.name,
        verified: false,
        reason: `wrong_type_${(bestMatch.types || []).slice(0,2).join(',')}_for_tags:${place.tags.join(',')}`,
      }
    }

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
