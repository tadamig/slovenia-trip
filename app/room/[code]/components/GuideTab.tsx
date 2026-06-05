'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { setOptions, importLibrary } from '@googlemaps/js-api-loader'
import { supabase, GuidePlace } from '@/lib/supabase'
import { MapPin, Navigation, Crosshair, Search, Star } from 'lucide-react'

const GMAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || ''

// Kategorie: kolejność, etykieta, emoji, kolor pinezki.
const CATEGORIES: { key: string; label: string; emoji: string; color: string }[] = [
  { key: 'attraction', label: 'Atrakcje', emoji: '🏛️', color: '#3d7f41' },
  { key: 'restaurant', label: 'Restauracje', emoji: '🍴', color: '#e0792b' },
  { key: 'beach', label: 'Plaże', emoji: '🏖️', color: '#2cc4ff' },
  { key: 'trail', label: 'Szlaki', emoji: '🥾', color: '#3d7f41' },
  { key: 'wine', label: 'Winiarnie', emoji: '🍷', color: '#a23bbf' },
  { key: 'camping', label: 'Campingi', emoji: '⛺', color: '#0ea5a3' },
  { key: 'lodging', label: 'Noclegi', emoji: '🛏️', color: '#8b5cf6' },
  { key: 'parking', label: 'Parkingi', emoji: '🅿️', color: '#78716c' },
]
const CAT = Object.fromEntries(CATEGORIES.map((c) => [c.key, c]))

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
const fmtKm = (km: number) => (km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`)
const navUrl = (lat: number, lon: number) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`
const viewUrl = (name: string, lat: number, lon: number) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}%20${lat},${lon}`

export default function GuideTab() {
  const [places, setPlaces] = useState<GuidePlace[]>([])
  const [loading, setLoading] = useState(true)
  const [cat, setCat] = useState('attraction')
  const [query, setQuery] = useState('')
  const [userPos, setUserPos] = useState<{ lat: number; lon: number } | null>(null)
  const [geoState, setGeoState] = useState<'idle' | 'loading' | 'denied' | 'ok'>('idle')

  const mapWrapRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<google.maps.Map | null>(null)
  const infoRef = useRef<google.maps.InfoWindow | null>(null)
  const userMarkerRef = useRef<google.maps.Marker | null>(null)
  const markersRef = useRef<Record<string, google.maps.Marker>>({})
  const [mapReady, setMapReady] = useState(false)

  useEffect(() => {
    supabase.from('guide_places').select('*').then(({ data }) => {
      setPlaces((data as GuidePlace[]) || [])
      setLoading(false)
    })
  }, [])

  // Inicjalizacja mapy (raz).
  useEffect(() => {
    if (!GMAPS_KEY) return
    let cancelled = false
    setOptions({ key: GMAPS_KEY, v: 'weekly' })
    importLibrary('maps').then(({ Map, InfoWindow }) => {
      if (cancelled || !mapRef.current || mapInstanceRef.current) return
      const map = new Map(mapRef.current, {
        center: { lat: 46.15, lng: 14.99 }, zoom: 8,
        disableDefaultUI: true, zoomControl: true, gestureHandling: 'greedy',
      })
      mapInstanceRef.current = map
      infoRef.current = new InfoWindow()
      setMapReady(true)
    }).catch(() => {})
    return () => {
      cancelled = true
      Object.values(markersRef.current).forEach((m) => m.setMap(null))
      markersRef.current = {}
      userMarkerRef.current?.setMap(null); userMarkerRef.current = null
      mapInstanceRef.current = null; infoRef.current = null
    }
  }, [])

  const askLocation = () => {
    if (!navigator.geolocation) { setGeoState('denied'); return }
    setGeoState('loading')
    navigator.geolocation.getCurrentPosition(
      (pos) => { setUserPos({ lat: pos.coords.latitude, lon: pos.coords.longitude }); setGeoState('ok') },
      () => setGeoState('denied'),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    )
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    places.forEach((p) => { c[p.category] = (c[p.category] || 0) + 1 })
    return c
  }, [places])

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    let arr = places.filter((p) => p.category === cat)
    if (q) arr = arr.filter((p) => p.name.toLowerCase().includes(q))
    const withDist = arr.map((p) => ({
      p,
      dist: userPos && p.lat != null && p.lon != null ? haversineKm(userPos.lat, userPos.lon, p.lat, p.lon) : null,
    }))
    withDist.sort((a, b) => {
      if (a.dist != null && b.dist != null) return a.dist - b.dist
      if (a.dist != null) return -1
      if (b.dist != null) return 1
      return a.p.name.localeCompare(b.p.name)
    })
    return withDist
  }, [places, cat, query, userPos])

  // Markery z emotkami dla bieżącej kategorii.
  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map || !mapReady) return
    Object.values(markersRef.current).forEach((m) => m.setMap(null))
    markersRef.current = {}
    const meta = CAT[cat]
    const bounds = new google.maps.LatLngBounds()
    let any = false
    list.forEach(({ p }) => {
      if (p.lat == null || p.lon == null) return
      any = true
      bounds.extend({ lat: p.lat, lng: p.lon })
      const marker = new google.maps.Marker({
        position: { lat: p.lat, lng: p.lon }, map,
        label: { text: meta?.emoji || '📍', fontSize: '14px' },
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 13, fillColor: '#ffffff', fillOpacity: 1, strokeColor: meta?.color || '#3d7f41', strokeWeight: 2 },
        title: p.name,
      })
      marker.addListener('click', () => openInfo(p))
      markersRef.current[p.id] = marker
    })
    if (any) map.fitBounds(bounds, 40)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, mapReady, cat])

  // Marker lokalizacji użytkownika.
  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map || !mapReady || !userPos) return
    userMarkerRef.current?.setMap(null)
    userMarkerRef.current = new google.maps.Marker({
      position: { lat: userPos.lat, lng: userPos.lon }, map,
      icon: { path: google.maps.SymbolPath.CIRCLE, scale: 7, fillColor: '#2563eb', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
      title: 'Twoja lokalizacja', zIndex: 999,
    })
  }, [userPos, mapReady])

  function openInfo(p: GuidePlace) {
    const map = mapInstanceRef.current
    if (!map || p.lat == null || p.lon == null) return
    infoRef.current?.setContent(
      `<div style="color:#1c1917;font-family:system-ui;min-width:150px">
         <strong>${p.name}</strong><br/>
         <span style="font-size:12px;color:#57534e">${CAT[p.category]?.label || ''}</span><br/>
         <a href="${navUrl(p.lat, p.lon)}" target="_blank" rel="noopener noreferrer" style="font-size:12px;color:#0284c7;font-weight:600">Nawiguj →</a>
       </div>`,
    )
    const marker = markersRef.current[p.id]
    if (marker) infoRef.current?.open(map, marker)
  }

  // Klik w kafelek → wycentruj mapę na pinezce + otwórz dymek + przewiń do mapy.
  function focusPlace(p: GuidePlace) {
    const map = mapInstanceRef.current
    if (!map || p.lat == null || p.lon == null) return
    map.panTo({ lat: p.lat, lng: p.lon })
    map.setZoom(14)
    openInfo(p)
    mapWrapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="px-4 py-5 max-w-lg mx-auto space-y-4">
      <div>
        <h2 className="font-display text-lg font-semibold text-stone-100">📖 Przewodnik</h2>
        <p className="text-stone-500 text-xs mt-0.5">
          {loading ? 'Wczytuję…' : `${places.length} miejsc z przewodnika Couple Away`}
        </p>
      </div>

      {/* Mapa-overlay */}
      <div ref={mapWrapRef} className="rounded-2xl overflow-hidden border border-stone-800 relative" style={{ height: 300 }}>
        <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
        {(!GMAPS_KEY || !mapReady) && (
          <div className="absolute inset-0 flex items-center justify-center bg-stone-900">
            <p className="text-stone-500 text-sm">{GMAPS_KEY ? 'Ładowanie mapy…' : 'Mapa nieaktywna'}</p>
          </div>
        )}
      </div>

      {/* Lokalizacja */}
      {geoState !== 'ok' ? (
        <button
          onClick={askLocation}
          disabled={geoState === 'loading'}
          className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-gradient-to-r from-forest-700/40 to-water-700/40 border border-water-700/40 text-water-200 text-sm font-medium hover:border-water-500/60 transition-all disabled:opacity-60"
        >
          <Crosshair className="w-4 h-4" />
          {geoState === 'loading' ? 'Ustalam lokalizację…' : geoState === 'denied' ? 'Brak zgody — spróbuj ponownie' : 'Pokaż odległości od mojej lokalizacji'}
        </button>
      ) : (
        <p className="text-xs text-emerald-400 flex items-center gap-1.5">
          <Crosshair className="w-3.5 h-3.5" /> Lokalizacja włączona — sortuję od najbliższych (w linii prostej)
        </p>
      )}

      {/* Kategorie */}
      <div className="flex flex-wrap gap-1.5">
        {CATEGORIES.map((c) => {
          const n = counts[c.key] || 0
          if (!n) return null
          const on = cat === c.key
          return (
            <button
              key={c.key}
              onClick={() => setCat(c.key)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                on ? 'bg-forest-600 text-white border-forest-500' : 'bg-stone-800/60 text-stone-400 border-stone-700/40 hover:text-stone-200'
              }`}
            >
              {c.emoji} {c.label} <span className="opacity-70">{n}</span>
            </button>
          )
        })}
      </div>

      {/* Szukaj */}
      <div className="relative">
        <Search className="w-4 h-4 text-stone-600 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Szukaj po nazwie…"
          className="w-full bg-stone-800 border border-stone-700 rounded-xl pl-9 pr-3 py-2.5 text-stone-100 placeholder-stone-600 text-sm focus:outline-none focus:border-forest-500"
        />
      </div>

      {/* Lista */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => <div key={i} className="h-14 bg-stone-800/40 rounded-xl animate-pulse" />)}
        </div>
      ) : list.length === 0 ? (
        <p className="text-stone-600 text-sm text-center py-8">Brak wyników w tej kategorii.</p>
      ) : (
        <div className="space-y-1.5">
          {list.map(({ p, dist }) => (
            <button
              key={p.id}
              onClick={() => focusPlace(p)}
              className="w-full flex items-start gap-2.5 bg-stone-800/40 border border-stone-700/30 rounded-xl px-3 py-2.5 text-left hover:border-forest-700/50 transition-all"
            >
              <span className="text-base flex-shrink-0 mt-0.5">{CAT[p.category]?.emoji || '📍'}</span>
              <div className="flex-1 min-w-0">
                <p className="text-stone-100 text-sm font-medium">{p.name}</p>
                <div className="flex items-center gap-2 mt-0.5 text-[11px] text-stone-500 flex-wrap">
                  <span>{CAT[p.category]?.label || p.category}</span>
                  {p.google_rating != null && p.google_rating > 0 && (
                    <span className="text-amber-400 flex items-center gap-0.5"><Star className="w-3 h-3" /> {p.google_rating}{p.google_total_ratings ? ` (${p.google_total_ratings})` : ''}</span>
                  )}
                  {dist != null && <span className="text-water-400">{fmtKm(dist)}</span>}
                </div>
                {p.description && <p className="text-stone-400 text-xs mt-1 leading-relaxed">{p.description}</p>}
                {p.lat != null && p.lon != null && (
                  <div className="flex items-center gap-3 mt-1.5" onClick={(e) => e.stopPropagation()}>
                    <a href={navUrl(p.lat, p.lon)} target="_blank" rel="noopener noreferrer" className="text-[11px] text-water-400 hover:text-water-300 inline-flex items-center gap-1">
                      <Navigation className="w-3 h-3" /> Nawiguj
                    </a>
                    <a href={viewUrl(p.name, p.lat, p.lon)} target="_blank" rel="noopener noreferrer" className="text-[11px] text-stone-500 hover:text-stone-300 inline-flex items-center gap-1">
                      <MapPin className="w-3 h-3" /> Google Maps
                    </a>
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
