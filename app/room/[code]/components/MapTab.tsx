'use client'

import { useEffect, useState, useRef } from 'react'
import { Room, UserPreference, SavedPlace } from '@/lib/supabase'
import { supabase } from '@/lib/supabase'
import { Clock, Ruler } from 'lucide-react'

interface Props {
  room: Room
  myPrefs: UserPreference
}

const BASE_ROUTE = [
  { name: 'Budapeszt 🇭🇺', lat: 47.4979, lon: 19.0402, days: '2 dni', description: 'Termy, ruin bary, Dunaj' },
  { name: 'Bled 🇸🇮', lat: 46.3683, lon: 14.1146, days: '2 dni', description: 'Jezioro, zamek, SUP' },
  { name: 'Dolina Soča', lat: 46.1637, lon: 13.5739, days: '2 dni', description: 'Rzeka, rafting, kąpiel' },
  { name: 'Ljubljana', lat: 46.0569, lon: 14.5058, days: '1 dzień', description: 'Stare Miasto, targ' },
  { name: 'Piran / Adriatyk', lat: 45.5283, lon: 13.5683, days: '1 dzień', description: 'Plaże, SUP na morzu' },
]

const NEARBY: Record<string, { name: string; tags: string[]; desc: string }[]> = {
  'Budapeszt 🇭🇺': [
    { name: 'Szechenyi Thermal Bath', tags: ['relax'], desc: 'Termy na regenerację' },
    { name: 'Wzgórze Gellérta', tags: ['sunset', 'photo'], desc: 'Zachód słońca nad Dunajem' },
    { name: 'SUP na Dunaju', tags: ['sup'], desc: 'Widok na Parlament z wody' },
    { name: 'Targ Wielka Hala', tags: ['food', 'markets'], desc: 'Langos, papryka, lokalne smaki' },
  ],
  'Bled 🇸🇮': [
    { name: 'Jezioro Bled — SUP', tags: ['sup', 'photo'], desc: 'Ikoniczne zdjęcia z deski' },
    { name: 'Vintgar Gorge', tags: ['trekking'], desc: 'Trek nad wodospadami' },
    { name: 'Bohinjsko jezero', tags: ['sup', 'relax'], desc: 'Spokojniejsze niż Bled' },
    { name: 'Zamek Bled', tags: ['sightseeing', 'sunset'], desc: 'Widok na jezioro z góry' },
  ],
  'Dolina Soča': [
    { name: 'Rzeka Soča — SUP', tags: ['sup'], desc: 'Turkusowa woda alpejska' },
    { name: 'Napoleon Bridge (Kobarid)', tags: ['photo', 'sightseeing'], desc: 'Historyczny most nad Sočą' },
    { name: 'Kozjak Waterfall', tags: ['trekking', 'photo'], desc: 'Wodospad w jaskini' },
  ],
  'Ljubljana': [
    { name: 'Targ Centralny', tags: ['food', 'markets'], desc: 'Lokalne produkty i street food' },
    { name: 'Zamek Lublana', tags: ['sightseeing', 'photo'], desc: 'Widok na całe miasto' },
    { name: 'Metelkova', tags: ['nightlife'], desc: 'Alternatywna strefa kulturalna' },
  ],
  'Piran / Adriatyk': [
    { name: 'Piran — Stare Miasto', tags: ['sightseeing', 'photo'], desc: 'Wenecka architektura' },
    { name: 'Plaża Strunjan', tags: ['sup', 'relax', 'sunset'], desc: 'Klifowe plaże, SUP na morzu' },
    { name: 'Portorož', tags: ['relax', 'food'], desc: 'Promenada, restauracje' },
  ],
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)))
}

function getTagEmoji(tag: string): string {
  const map: Record<string, string> = {
    sup: '🏄', trekking: '🥾', food: '🍽️', sunset: '🌅',
    sightseeing: '🏛️', relax: '🧘', photo: '📸', markets: '🛒', nightlife: '🍺',
  }
  return map[tag] || '📍'
}

export default function MapTab({ room, myPrefs }: Props) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<any>(null)
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([])
  const [selectedPoint, setSelectedPoint] = useState<typeof BASE_ROUTE[0] | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const groupActivities = myPrefs.activities || []

  useEffect(() => {
    supabase.from('saved_places').select('*').eq('room_id', room.id).then(({ data }) => {
      setSavedPlaces(data || [])
    })
  }, [room.id])

  useEffect(() => {
    // Czekamy aż div będzie w DOM
    const timer = setTimeout(() => { initMap() }, 100)
    return () => {
      clearTimeout(timer)
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove()
        mapInstanceRef.current = null
        setMapReady(false)
      }
    }
  }, [])

  async function initMap() {
    if (!mapRef.current || mapInstanceRef.current) return

    const L = (await import('leaflet')).default

    // Fix marker icons
    delete (L.Icon.Default.prototype as any)._getIconUrl
    L.Icon.Default.mergeOptions({
      iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
      iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
      shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    })

    const map = L.map(mapRef.current, {
      center: [46.5, 16.0],
      zoom: 6,
      zoomControl: true,
      attributionControl: true,
    })

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map)

    mapInstanceRef.current = map

    // Trasa
    const coords = BASE_ROUTE.map(p => [p.lat, p.lon] as [number, number])
    L.polyline(coords, { color: '#3d7f41', weight: 3, opacity: 0.8, dashArray: '8,4' }).addTo(map)

    // Markery trasy
    BASE_ROUTE.forEach((point, i) => {
      const icon = L.divIcon({
        html: `<div style="background:#3d7f41;border:2px solid #fff;border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:bold;font-size:11px;box-shadow:0 2px 6px rgba(0,0,0,0.5)">${i + 1}</div>`,
        className: '',
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      })
      L.marker([point.lat, point.lon], { icon })
        .addTo(map)
        .bindPopup(`<strong>${point.name}</strong><br><small>${point.days} · ${point.description}</small>`)
        .on('click', () => setSelectedPoint(point))
    })

    // Dopasuj widok
    map.fitBounds(coords, { padding: [40, 40] })

    // KLUCZOWE: invalidateSize po wyrenderowaniu
    setTimeout(() => {
      map.invalidateSize()
      setMapReady(true)
    }, 200)
  }

  const nearby = selectedPoint
    ? (NEARBY[selectedPoint.name] || []).filter(p =>
        groupActivities.length === 0 || p.tags.some(t => groupActivities.includes(t))
      )
    : []

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 112px)' }}>
      {/* Mapa - stała wysokość */}
      <div style={{ height: '55%', position: 'relative', minHeight: '280px' }}>
        <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
        {!mapReady && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1c1917', zIndex: 10 }}>
            <div className="text-center">
              <div className="text-4xl mb-2 animate-pulse">🗺️</div>
              <p className="text-stone-500 text-sm">Ładowanie mapy...</p>
            </div>
          </div>
        )}
        {/* Legenda */}
        <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 1000 }} className="bg-stone-900/90 backdrop-blur-sm border border-stone-700 rounded-xl p-2 space-y-1">
          <div className="flex items-center gap-2 text-xs text-stone-400">
            <div className="w-3 h-3 rounded-full bg-forest-600" /> Trasa
          </div>
          <div className="flex items-center gap-2 text-xs text-stone-400">
            <div className="w-3 h-3 rounded-full bg-water-600" /> Zapisane
          </div>
        </div>
      </div>

      {/* Lista punktów + panel boczny */}
      <div className="flex-1 overflow-y-auto bg-stone-900 border-t border-stone-800">
        <div className="px-4 pt-3 pb-2">
          <p className="text-xs text-stone-500 font-semibold uppercase tracking-wider mb-2">📍 Punkty trasy</p>
          <div className="space-y-1.5">
            {BASE_ROUTE.map((point, i) => {
              const next = BASE_ROUTE[i + 1]
              const dist = next ? haversine(point.lat, point.lon, next.lat, next.lon) : null
              const hours = dist ? Math.round(dist / 80) : null
              const isSelected = selectedPoint?.name === point.name

              return (
                <div key={point.name}>
                  <button
                    onClick={() => {
                      setSelectedPoint(isSelected ? null : point)
                      mapInstanceRef.current?.setView([point.lat, point.lon], 10)
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition-all ${
                      isSelected ? 'bg-forest-800/30 border border-forest-700/40' : 'bg-stone-800/40 border border-stone-700/30'
                    }`}
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

        {/* Panel pobliskich miejsc */}
        {selectedPoint && nearby.length > 0 && (
          <div className="px-4 pb-4 border-t border-stone-800 pt-3">
            <p className="text-xs text-stone-500 font-semibold uppercase tracking-wider mb-2">
              🎯 Pobliskie — pasują do ekipy
            </p>
            <div className="space-y-1.5">
              {nearby.map(place => (
                <div key={place.name} className="flex items-center gap-3 bg-stone-800/40 border border-stone-700/30 rounded-xl px-3 py-2">
                  <span className="text-base">{getTagEmoji(place.tags[0])}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-stone-200 text-xs font-medium">{place.name}</p>
                    <p className="text-stone-500 text-xs">{place.desc}</p>
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
