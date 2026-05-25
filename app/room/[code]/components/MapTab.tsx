'use client'

import { useEffect, useState, useRef } from 'react'
import { Room, UserPreference, SavedPlace } from '@/lib/supabase'
import { supabase } from '@/lib/supabase'
import { MapPin, Navigation, Clock, Ruler } from 'lucide-react'

interface Props {
  room: Room
  myPrefs: UserPreference
}

interface RoutePoint {
  name: string
  lat: number
  lon: number
  days?: string
  description?: string
}

// Stałe punkty trasy
const BASE_ROUTE: RoutePoint[] = [
  { name: 'Budapeszt 🇭🇺', lat: 47.4979, lon: 19.0402, days: '2 dni', description: 'Termy, ruin bary, Dunaj' },
  { name: 'Bled 🇸🇮', lat: 46.3683, lon: 14.1146, days: '2 dni', description: 'Jezioro, zamek, SUP' },
  { name: 'Dolina Soča', lat: 46.1637, lon: 13.5739, days: '2 dni', description: 'Rzeka, rafting, kąpiel' },
  { name: 'Ljubljana', lat: 46.0569, lon: 14.5058, days: '1 dzień', description: 'Stare Miasto, targ' },
  { name: 'Morze Adriatyckie', lat: 45.5317, lon: 13.6083, days: '1 dzień', description: 'Piran, Strunjan' },
]

const NEARBY_PLACES: Record<string, { name: string; tags: string[]; desc: string }[]> = {
  'Budapeszt 🇭🇺': [
    { name: 'Szechenyi Thermal Bath', tags: ['relax'], desc: 'Termy na regenerację' },
    { name: 'Wzgórze Gellérta', tags: ['sunset', 'photo'], desc: 'Zachód słońca nad Dunajem' },
    { name: 'SUP na Dunaju', tags: ['sup'], desc: 'Widok na Parlament z wody' },
  ],
  'Bled 🇸🇮': [
    { name: 'Jezioro Bled — SUP', tags: ['sup', 'photo'], desc: 'Ikoniczne zdjęcia z deski' },
    { name: 'Vintgar Gorge', tags: ['trekking'], desc: 'Trek nad wodospadami' },
    { name: 'Bohinjsko jezero', tags: ['sup', 'relax'], desc: 'Spokojniejsze niż Bled' },
  ],
  'Dolina Soča': [
    { name: 'Rzeka Soča — SUP', tags: ['sup'], desc: 'Turkusowa woda alpejska' },
    { name: 'Napoleon Bridge', tags: ['photo', 'sightseeing'], desc: 'Historyczny most nad Sočą' },
  ],
  'Ljubljana': [
    { name: 'Targ Centralny', tags: ['food', 'markets'], desc: 'Lokalne produkty i street food' },
    { name: 'Zamek Lublana', tags: ['sightseeing', 'photo'], desc: 'Widok na całe miasto' },
  ],
  'Morze Adriatyckie': [
    { name: 'Piran — Stare Miasto', tags: ['sightseeing', 'photo'], desc: 'Wenecka architektura' },
    { name: 'SUP na Adriatyku', tags: ['sup', 'sunset'], desc: 'Klifowe plaże Strunjana' },
  ],
}

function getTagEmoji(tag: string): string {
  const map: Record<string, string> = {
    sup: '🏄', trekking: '🥾', food: '🍽️', sunset: '🌅',
    sightseeing: '🏛️', relax: '🧘', photo: '📸', markets: '🛒',
  }
  return map[tag] || '📍'
}

export default function MapTab({ room, myPrefs }: Props) {
  const mapRef = useRef<any>(null)
  const mapInstanceRef = useRef<any>(null)
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([])
  const [selectedPoint, setSelectedPoint] = useState<RoutePoint | null>(null)
  const [mapReady, setMapReady] = useState(false)

  const groupActivities = myPrefs.activities || []

  useEffect(() => {
    loadSavedPlaces()
  }, [room.id])

  async function loadSavedPlaces() {
    const { data } = await supabase.from('saved_places').select('*').eq('room_id', room.id)
    setSavedPlaces(data || [])
  }

  useEffect(() => {
    if (typeof window === 'undefined') return
    initMap()
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove()
        mapInstanceRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (mapReady && savedPlaces.length > 0) {
      addSavedPlaceMarkers()
    }
  }, [mapReady, savedPlaces])

  async function initMap() {
    const L = (await import('leaflet')).default

    if (mapInstanceRef.current || !mapRef.current) return

    // Fix default icon
    delete (L.Icon.Default.prototype as any)._getIconUrl
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
      iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
      shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    })

    const map = L.map(mapRef.current, {
      center: [46.8, 16.5],
      zoom: 6,
      zoomControl: true,
    })

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map)

    mapInstanceRef.current = map

    // Rysuj trasę
    const routeCoords = BASE_ROUTE.map(p => [p.lat, p.lon] as [number, number])

    // Linia trasy
    L.polyline(routeCoords, {
      color: '#3d7f41',
      weight: 3,
      opacity: 0.7,
      dashArray: '8, 4',
    }).addTo(map)

    // Markery dla punktów trasy
    BASE_ROUTE.forEach((point, i) => {
      const icon = L.divIcon({
        html: `<div style="
          background: #3d7f41;
          border: 2px solid #1a341d;
          border-radius: 50%;
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-weight: bold;
          font-size: 12px;
          box-shadow: 0 2px 6px rgba(0,0,0,0.4);
        ">${i + 1}</div>`,
        className: '',
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      })

      const marker = L.marker([point.lat, point.lon], { icon })
        .addTo(map)
        .bindPopup(`
          <div style="font-family: sans-serif; min-width: 150px;">
            <strong style="font-size: 14px;">${point.name}</strong><br>
            <span style="color: #666; font-size: 12px;">${point.days} · ${point.description}</span>
          </div>
        `, { maxWidth: 200 })

      marker.on('click', () => {
        setSelectedPoint(point)
      })
    })

    // Dopasuj widok do trasy
    map.fitBounds(routeCoords, { padding: [30, 30] })
    setMapReady(true)
  }

  async function addSavedPlaceMarkers() {
    if (!mapInstanceRef.current) return
    const L = (await import('leaflet')).default

    savedPlaces.forEach(sp => {
      const data = sp.place_data as any
      if (!data.coordinates) return

      const icon = L.divIcon({
        html: `<div style="
          background: #0085cc;
          border: 2px solid #064a70;
          border-radius: 50%;
          width: 22px;
          height: 22px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        ">❤️</div>`,
        className: '',
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      })

      L.marker(data.coordinates, { icon })
        .addTo(mapInstanceRef.current)
        .bindPopup(`
          <div style="font-family: sans-serif;">
            <strong>${sp.place_name}</strong><br>
            <span style="color: #666; font-size: 12px;">👍 ${sp.votes} głosów</span>
          </div>
        `)
    })
  }

  // Oblicz przybliżone odległości między punktami (km)
  function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371
    const dLat = (lat2 - lat1) * Math.PI / 180
    const dLon = (lon2 - lon1) * Math.PI / 180
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
    return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)))
  }

  const nearby = selectedPoint ? (NEARBY_PLACES[selectedPoint.name] || []).filter(p =>
    groupActivities.length === 0 || p.tags.some(t => groupActivities.includes(t))
  ) : []

  return (
    <div className="flex flex-col h-screen max-h-screen">
      {/* Map */}
      <div className="flex-1 relative" style={{ minHeight: '55vh' }}>
        <div ref={mapRef} className="w-full h-full" />
        {!mapReady && (
          <div className="absolute inset-0 flex items-center justify-center bg-stone-900">
            <div className="text-center">
              <div className="text-4xl mb-3 animate-pulse-soft">🗺️</div>
              <p className="text-stone-500 text-sm">Ładowanie mapy...</p>
            </div>
          </div>
        )}
        {/* Legenda */}
        <div className="absolute top-3 right-3 bg-stone-900/90 backdrop-blur-sm border border-stone-700 rounded-xl p-2.5 space-y-1.5 z-[1000]">
          <div className="flex items-center gap-2 text-xs text-stone-400">
            <div className="w-3 h-3 rounded-full bg-forest-600 border border-forest-800" />
            Trasa
          </div>
          <div className="flex items-center gap-2 text-xs text-stone-400">
            <div className="w-3 h-3 rounded-full bg-water-600 border border-water-900" />
            Zapisane
          </div>
        </div>
      </div>

      {/* Route list + side panel */}
      <div className="bg-stone-900 border-t border-stone-800 overflow-y-auto" style={{ maxHeight: '45vh' }}>
        {/* Route segments */}
        <div className="px-4 pt-4 pb-2">
          <h3 className="text-xs text-stone-500 font-semibold uppercase tracking-wider mb-3">
            📍 Punkty trasy — kliknij na mapie lub na liście
          </h3>
          <div className="space-y-1.5">
            {BASE_ROUTE.map((point, i) => {
              const next = BASE_ROUTE[i + 1]
              const dist = next ? haversine(point.lat, point.lon, next.lat, next.lon) : null
              const hours = dist ? Math.round(dist / 80) : null

              return (
                <div key={point.name}>
                  <button
                    onClick={() => {
                      setSelectedPoint(selectedPoint?.name === point.name ? null : point)
                      if (mapInstanceRef.current) {
                        mapInstanceRef.current.setView([point.lat, point.lon], 10)
                      }
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all ${
                      selectedPoint?.name === point.name
                        ? 'bg-forest-800/30 border border-forest-700/40'
                        : 'bg-stone-800/40 border border-stone-700/30 hover:bg-stone-800/60'
                    }`}
                  >
                    <div className="w-6 h-6 rounded-full bg-forest-700 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-stone-200 text-sm font-medium">{point.name}</p>
                      <p className="text-stone-500 text-xs">{point.days} · {point.description}</p>
                    </div>
                  </button>

                  {dist && (
                    <div className="flex items-center gap-2 px-4 py-1 text-stone-700 text-xs">
                      <div className="w-px h-4 bg-forest-800 ml-2.5" />
                      <Ruler className="w-3 h-3" /> {dist} km
                      <Clock className="w-3 h-3 ml-1" /> ~{hours}h jazdy
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Nearby recommendations panel */}
        {selectedPoint && nearby.length > 0 && (
          <div className="px-4 pb-4 border-t border-stone-800 pt-3">
            <p className="text-xs text-stone-500 font-semibold uppercase tracking-wider mb-2">
              📍 Pobliskie miejsca pasujące do ekipy
            </p>
            <div className="space-y-2">
              {nearby.map(place => (
                <div key={place.name} className="flex items-center gap-3 bg-stone-800/40 border border-stone-700/30 rounded-xl px-3 py-2.5">
                  <span className="text-lg">{place.tags.map(getTagEmoji)[0]}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-stone-200 text-xs font-medium">{place.name}</p>
                    <p className="text-stone-500 text-xs">{place.desc}</p>
                  </div>
                  <div className="flex gap-1">
                    {place.tags.map(t => (
                      <span key={t} className={`text-xs px-1.5 py-0.5 rounded-full ${
                        groupActivities.includes(t)
                          ? 'bg-forest-800/40 text-forest-400 border border-forest-700/30'
                          : 'bg-stone-700 text-stone-500'
                      }`}>
                        {getTagEmoji(t)}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
