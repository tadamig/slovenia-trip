'use client'

import { useEffect, useState, useRef } from 'react'
import { setOptions, importLibrary } from '@googlemaps/js-api-loader'
import { Room, UserPreference, SavedPlace } from '@/lib/supabase'
import { supabase } from '@/lib/supabase'
import { Clock, Ruler, MapPin } from 'lucide-react'

interface Props {
  room: Room
  myPrefs: UserPreference
}

const GMAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || ''

// Szkielet planowanej trasy (backbone wyprawy). Pobliskie miejsca pochodzą już
// z realnych danych ekipy (saved_places), nie z listy na sztywno.
const BASE_ROUTE = [
  { name: 'Budapeszt 🇭🇺', lat: 47.4979, lon: 19.0402, days: '2 dni', description: 'Termy, ruin bary, Dunaj' },
  { name: 'Bled 🇸🇮', lat: 46.3683, lon: 14.1146, days: '2 dni', description: 'Jezioro, zamek, SUP' },
  { name: 'Dolina Soča', lat: 46.1637, lon: 13.5739, days: '2 dni', description: 'Rzeka, rafting, kąpiel' },
  { name: 'Ljubljana', lat: 46.0569, lon: 14.5058, days: '1 dzień', description: 'Stare Miasto, targ' },
  { name: 'Piran / Adriatyk', lat: 45.5283, lon: 13.5683, days: '1 dzień', description: 'Plaże, SUP na morzu' },
]

// Ciemny styl mapy pod motyw aplikacji (stone-950).
const DARK_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#1c1917' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1c1917' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#a8a29e' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#57534e' }] },
  { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#78716c' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#1f2a1f' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#292524' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#78716c' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#44403c' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#292524' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0c2733' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#2cc4ff' }] },
]

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)))
}

const ACTIVITY_TAGS: Record<string, string> = {
  sup: '🏄 SUP', trekking: '🥾 Trekking', food: '🍽️ Jedzenie', sunset: '🌅 Widok',
  sightseeing: '🏛️ Zwiedzanie', relax: '🧘 Relaks', photo: '📸 Foto', markets: '🛒 Targi', nightlife: '🍺 Nocne życie',
}

// Współrzędne zapisanego miejsca z place_data (Faza 0). Starsze wpisy bez
// współrzędnych po prostu nie mają markera (zwracamy null).
function placeCoords(sp: SavedPlace): { lat: number; lon: number } | null {
  const c = sp.place_data?.coordinates
  if (Array.isArray(c) && typeof c[0] === 'number' && typeof c[1] === 'number') {
    return { lat: c[0], lon: c[1] }
  }
  return null
}

function navUrl(lat: number, lon: number, placeId?: string): string {
  return placeId
    ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&destination_place_id=${placeId}`
    : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`
}

export default function MapTab({ room, myPrefs }: Props) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<google.maps.Map | null>(null)
  const infoRef = useRef<google.maps.InfoWindow | null>(null)
  const savedMarkersRef = useRef<google.maps.Marker[]>([])
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([])
  const [mapReady, setMapReady] = useState(false)
  const [loadError, setLoadError] = useState('')

  // Wczytaj zapisane miejsca ekipy.
  useEffect(() => {
    supabase.from('saved_places').select('*').eq('room_id', room.id).then(({ data }) => {
      setSavedPlaces(data || [])
    })
  }, [room.id])

  // Inicjalizacja mapy Google (raz).
  useEffect(() => {
    if (!GMAPS_KEY) { setLoadError('no-key'); return }
    let cancelled = false
    setOptions({ key: GMAPS_KEY, v: 'weekly' })

    importLibrary('maps').then(({ Map, InfoWindow, Polyline }) => {
      if (cancelled || !mapRef.current || mapInstanceRef.current) return

      const map = new Map(mapRef.current, {
        center: { lat: 46.5, lng: 15.0 },
        zoom: 7,
        styles: DARK_STYLE,
        disableDefaultUI: true,
        zoomControl: true,
        gestureHandling: 'greedy',
      })
      mapInstanceRef.current = map
      infoRef.current = new InfoWindow()

      // Linia trasy + numerowane markery
      const path = BASE_ROUTE.map(p => ({ lat: p.lat, lng: p.lon }))
      new Polyline({ path, map, strokeColor: '#3d7f41', strokeOpacity: 0.85, strokeWeight: 3 })

      const bounds = new google.maps.LatLngBounds()
      BASE_ROUTE.forEach((p, i) => {
        bounds.extend({ lat: p.lat, lng: p.lon })
        const marker = new google.maps.Marker({
          position: { lat: p.lat, lng: p.lon },
          map,
          label: { text: String(i + 1), color: '#fff', fontSize: '11px', fontWeight: 'bold' },
          icon: {
            path: google.maps.SymbolPath.CIRCLE, scale: 12,
            fillColor: '#3d7f41', fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 2,
          },
          title: p.name,
        })
        marker.addListener('click', () => {
          infoRef.current?.setContent(
            `<div style="color:#1c1917;font-family:system-ui;min-width:140px">
               <strong>${p.name}</strong><br/><span style="font-size:12px;color:#57534e">${p.days} · ${p.description}</span>
             </div>`,
          )
          infoRef.current?.open(map, marker)
        })
      })
      map.fitBounds(bounds, 48)
      setMapReady(true)
    }).catch(() => { if (!cancelled) setLoadError('load-failed') })

    return () => {
      cancelled = true
      savedMarkersRef.current.forEach(m => m.setMap(null))
      savedMarkersRef.current = []
      mapInstanceRef.current = null
      infoRef.current = null
    }
  }, [])

  // Dorysuj markery zapisanych miejsc (gdy mapa gotowa lub zmieni się lista).
  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map || !mapReady) return
    savedMarkersRef.current.forEach(m => m.setMap(null))
    savedMarkersRef.current = []

    savedPlaces.forEach(sp => {
      const c = placeCoords(sp)
      if (!c) return
      const placeId = sp.place_data?.place_id
      const marker = new google.maps.Marker({
        position: { lat: c.lat, lng: c.lon },
        map,
        icon: {
          path: google.maps.SymbolPath.CIRCLE, scale: 8,
          fillColor: '#2cc4ff', fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 2,
        },
        title: sp.place_name,
      })
      marker.addListener('click', () => {
        const tags = (sp.tags as string[] || []).map(t => ACTIVITY_TAGS[t] || t).join(' · ')
        infoRef.current?.setContent(
          `<div style="color:#1c1917;font-family:system-ui;min-width:160px">
             <strong>${sp.place_name}</strong>
             ${tags ? `<br/><span style="font-size:12px;color:#57534e">${tags}</span>` : ''}
             <br/><a href="${navUrl(c.lat, c.lon, placeId)}" target="_blank" rel="noopener noreferrer"
               style="font-size:12px;color:#0284c7;font-weight:600">Nawiguj w Google Maps →</a>
           </div>`,
        )
        infoRef.current?.open(map, marker)
      })
      savedMarkersRef.current.push(marker)
    })
  }, [savedPlaces, mapReady])

  const focusPlace = (lat: number, lon: number) => {
    const map = mapInstanceRef.current
    if (!map) return
    map.panTo({ lat, lng: lon })
    map.setZoom(11)
  }

  const savedWithCoords = savedPlaces.filter(sp => placeCoords(sp))

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 112px)' }}>
      {/* Mapa */}
      <div style={{ height: '55%', position: 'relative', minHeight: '280px' }}>
        <div ref={mapRef} style={{ width: '100%', height: '100%' }} />

        {/* Brak klucza / błąd ładowania */}
        {(loadError || (!mapReady && !GMAPS_KEY)) && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1c1917', zIndex: 10 }}>
            <div className="text-center px-6">
              <div className="text-4xl mb-2">🗺️</div>
              <p className="text-stone-400 text-sm font-medium">Mapa Google jeszcze nieaktywna</p>
              <p className="text-stone-600 text-xs mt-1">
                {loadError === 'load-failed'
                  ? 'Nie udało się załadować mapy — sprawdź klucz / ograniczenia w Google Cloud.'
                  : 'Brak klucza NEXT_PUBLIC_GOOGLE_MAPS_KEY na środowisku.'}
              </p>
            </div>
          </div>
        )}

        {/* Loader */}
        {!mapReady && !loadError && GMAPS_KEY && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1c1917', zIndex: 10 }}>
            <div className="text-center">
              <div className="text-4xl mb-2 animate-pulse">🗺️</div>
              <p className="text-stone-500 text-sm">Ładowanie mapy...</p>
            </div>
          </div>
        )}

        {/* Legenda */}
        {mapReady && (
          <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 5 }} className="bg-stone-900/90 backdrop-blur-sm border border-stone-700 rounded-xl p-2 space-y-1">
            <div className="flex items-center gap-2 text-xs text-stone-400">
              <div className="w-3 h-3 rounded-full bg-forest-600" /> Trasa
            </div>
            <div className="flex items-center gap-2 text-xs text-stone-400">
              <div className="w-3 h-3 rounded-full bg-water-400" /> Zapisane
            </div>
          </div>
        )}
      </div>

      {/* Lista punktów + zapisane miejsca */}
      <div className="flex-1 overflow-y-auto bg-stone-900 border-t border-stone-800">
        <div className="px-4 pt-3 pb-2">
          <p className="text-xs text-stone-500 font-semibold uppercase tracking-wider mb-2">📍 Punkty trasy</p>
          <div className="space-y-1.5">
            {BASE_ROUTE.map((point, i) => {
              const next = BASE_ROUTE[i + 1]
              const dist = next ? haversine(point.lat, point.lon, next.lat, next.lon) : null
              const hours = dist ? Math.round(dist / 80) : null
              return (
                <div key={point.name}>
                  <button
                    onClick={() => focusPlace(point.lat, point.lon)}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition-all bg-stone-800/40 border border-stone-700/30 hover:border-forest-700/40"
                  >
                    <div className="w-5 h-5 rounded-full bg-forest-700 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">{i + 1}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-stone-200 text-xs font-medium">{point.name}</p>
                      <p className="text-stone-500 text-xs">{point.days} · {point.description}</p>
                    </div>
                  </button>
                  {dist && (
                    <div className="flex items-center gap-2 px-4 py-0.5 text-stone-700 text-xs">
                      <div className="w-px h-3 bg-stone-800 ml-2" />
                      <Ruler className="w-3 h-3" /> {dist} km
                      <Clock className="w-3 h-3 ml-1" /> ~{hours}h
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Zapisane przez ekipę (realne dane) */}
        <div className="px-4 pb-4 border-t border-stone-800 pt-3">
          <p className="text-xs text-stone-500 font-semibold uppercase tracking-wider mb-2">
            ❤️ Zapisane przez ekipę {savedWithCoords.length > 0 ? `(${savedWithCoords.length})` : ''}
          </p>
          {savedWithCoords.length === 0 ? (
            <p className="text-stone-600 text-xs bg-stone-800/30 border border-dashed border-stone-700/40 rounded-xl px-3 py-3">
              Zapisz miejsca w zakładce „Miejsca” — pojawią się tu na mapie z możliwością nawigacji.
            </p>
          ) : (
            <div className="space-y-1.5">
              {savedWithCoords.map(sp => {
                const c = placeCoords(sp)!
                return (
                  <button
                    key={sp.id}
                    onClick={() => focusPlace(c.lat, c.lon)}
                    className="w-full flex items-center gap-3 bg-stone-800/40 border border-stone-700/30 rounded-xl px-3 py-2 text-left hover:border-water-700/40 transition-all"
                  >
                    <MapPin className="w-4 h-4 text-water-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-stone-200 text-xs font-medium truncate">{sp.place_name}</p>
                      <p className="text-stone-500 text-xs truncate">
                        {(sp.tags as string[] || []).map(t => ACTIVITY_TAGS[t] || t).join(' · ') || 'Zapisane miejsce'}
                      </p>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
