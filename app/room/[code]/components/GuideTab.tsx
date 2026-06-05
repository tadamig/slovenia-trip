'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase, GuidePlace } from '@/lib/supabase'
import { MapPin, Navigation, Crosshair, Search, Star } from 'lucide-react'

// Kategorie w ustalonej kolejności + etykiety/emoji.
const CATEGORIES: { key: string; label: string }[] = [
  { key: 'attraction', label: '🏛️ Atrakcje' },
  { key: 'restaurant', label: '🍴 Restauracje' },
  { key: 'beach', label: '🏖️ Plaże' },
  { key: 'trail', label: '🥾 Szlaki' },
  { key: 'wine', label: '🍷 Winiarnie' },
  { key: 'camping', label: '⛺ Campingi' },
  { key: 'lodging', label: '🛏️ Noclegi' },
  { key: 'parking', label: '🅿️ Parkingi' },
]
const CAT_LABEL: Record<string, string> = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.label]))

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function fmtKm(km: number): string {
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`
}

function navUrl(lat: number, lon: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`
}
function viewUrl(name: string, lat: number, lon: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}%20${lat},${lon}`
}

export default function GuideTab() {
  const [places, setPlaces] = useState<GuidePlace[]>([])
  const [loading, setLoading] = useState(true)
  const [cat, setCat] = useState<string>('attraction')
  const [query, setQuery] = useState('')
  const [userPos, setUserPos] = useState<{ lat: number; lon: number } | null>(null)
  const [geoState, setGeoState] = useState<'idle' | 'loading' | 'denied' | 'ok'>('idle')

  useEffect(() => {
    supabase.from('guide_places').select('*').then(({ data }) => {
      setPlaces((data as GuidePlace[]) || [])
      setLoading(false)
    })
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

  return (
    <div className="px-4 py-5 max-w-lg mx-auto space-y-4">
      <div>
        <h2 className="font-display text-lg font-semibold text-stone-100">📖 Przewodnik</h2>
        <p className="text-stone-500 text-xs mt-0.5">
          {loading ? 'Wczytuję…' : `${places.length} miejsc z przewodnika Couple Away`}
        </p>
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
          const on = cat === c.key
          const n = counts[c.key] || 0
          if (!n) return null
          return (
            <button
              key={c.key}
              onClick={() => setCat(c.key)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                on ? 'bg-forest-600 text-white border-forest-500' : 'bg-stone-800/60 text-stone-400 border-stone-700/40 hover:text-stone-200'
              }`}
            >
              {c.label} <span className="opacity-70">{n}</span>
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
            <div key={p.id} className="flex items-start gap-2.5 bg-stone-800/40 border border-stone-700/30 rounded-xl px-3 py-2.5">
              <MapPin className="w-4 h-4 text-forest-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-stone-100 text-sm font-medium">{p.name}</p>
                <div className="flex items-center gap-2 mt-0.5 text-[11px] text-stone-500 flex-wrap">
                  <span>{CAT_LABEL[p.category] || p.category}</span>
                  {p.google_rating != null && (
                    <span className="text-amber-400 flex items-center gap-0.5"><Star className="w-3 h-3" /> {p.google_rating}</span>
                  )}
                  {dist != null && <span className="text-water-400">{fmtKm(dist)}</span>}
                </div>
                {p.description && <p className="text-stone-400 text-xs mt-1 leading-relaxed">{p.description}</p>}
                {p.lat != null && p.lon != null && (
                  <div className="flex items-center gap-3 mt-1.5">
                    <a href={navUrl(p.lat, p.lon)} target="_blank" rel="noopener noreferrer" className="text-[11px] text-water-400 hover:text-water-300 inline-flex items-center gap-1">
                      <Navigation className="w-3 h-3" /> Nawiguj
                    </a>
                    <a href={viewUrl(p.name, p.lat, p.lon)} target="_blank" rel="noopener noreferrer" className="text-[11px] text-stone-500 hover:text-stone-300 inline-flex items-center gap-1">
                      <MapPin className="w-3 h-3" /> Zobacz na mapie
                    </a>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
