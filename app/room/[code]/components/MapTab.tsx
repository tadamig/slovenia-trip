'use client'

import { useEffect, useState, useRef, useMemo, useCallback } from 'react'
import { setOptions, importLibrary } from '@googlemaps/js-api-loader'
import { Room, UserPreference, SavedPlace, ItineraryItem, DayInsightPayload, DayMeta } from '@/lib/supabase'
import { supabase } from '@/lib/supabase'
import { getSessionId } from '@/lib/session'
import { useItinerary } from './useItinerary'
import { tripDayCount, dateForDay, openingLineForDate, fetchDayWeather } from './itineraryUtils'
import DayPlanner, { Leg, NearbyRec } from './DayPlanner'

interface Props {
  room: Room
  myPrefs: UserPreference
}

const GMAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || ''

// Konkretne typy miejsc bazy dnia (Faza 3.5) — zgodne z POI_QUERIES w /api/discover.
const KNOWN_CATS = [
  'restaurant', 'cafe', 'bakery', 'bar', 'icecream', 'streetfood',
  'landmark', 'museum', 'park', 'viewpoint', 'sup', 'trekking', 'markets', 'photo',
]

// Mapowanie szerokich preferencji ekipy → konkretne typy (domyślne zaznaczenie).
const PREF_TO_CATS: Record<string, string[]> = {
  food: ['restaurant', 'cafe'],
  sightseeing: ['landmark', 'museum'],
  sup: ['sup'],
  trekking: ['trekking'],
  markets: ['markets'],
  nightlife: ['bar'],
  relax: ['park'],
  sunset: ['viewpoint'],
  photo: ['photo'],
}

function placeCoords(sp: SavedPlace): { lat: number; lon: number } | null {
  const c = sp.place_data?.coordinates
  if (Array.isArray(c) && typeof c[0] === 'number' && typeof c[1] === 'number') {
    return { lat: c[0], lon: c[1] }
  }
  return null
}

// metry → zwięzły tekst dystansu.
function fmtKm(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`
  const km = m / 1000
  return km >= 10 ? `${Math.round(km)} km` : `${km.toFixed(1)} km`
}

// Podpis składu dnia — gdy się zmieni, analiza AI jest nieaktualna.
function daySignature(items: ItineraryItem[]): string {
  return items.map((it) => `${it.id}:${it.lat},${it.lon}:${it.duration_min}:${it.start_time || ''}`).join('|')
}

export default function MapTab({ room, myPrefs }: Props) {
  const sessionId = typeof window !== 'undefined' ? getSessionId() : ''

  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<google.maps.Map | null>(null)
  const routeClassRef = useRef<typeof google.maps.routes.Route | null>(null)
  const routePolylineRef = useRef<google.maps.Polyline | null>(null)
  const stopMarkersRef = useRef<google.maps.Marker[]>([])
  const savedMarkersRef = useRef<google.maps.Marker[]>([])
  const recMarkersRef = useRef<google.maps.Marker[]>([])

  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([])
  const [mapReady, setMapReady] = useState(false)
  const [loadError, setLoadError] = useState('')

  const [selectedDay, setSelectedDay] = useState(0)
  const [extraDays, setExtraDays] = useState(0)
  const [legs, setLegs] = useState<Leg[]>([])
  const [routeLoading, setRouteLoading] = useState(false)

  // Analiza dnia (Faza 3) — cache w day_insights, współdzielony przez ekipę.
  const [insightsByDay, setInsightsByDay] = useState<Record<number, { signature: string; payload: DayInsightPayload }>>({})
  const [insightLoading, setInsightLoading] = useState(false)

  // Baza dnia (Faza 3.4) — miasto/promień/kategorie, współdzielone (realtime).
  const [dayMetaByDay, setDayMetaByDay] = useState<Record<number, DayMeta>>({})

  // Eksploracja wokół bazy dnia — wyniki + współrzędne bazy, cache po kluczu.
  const [nearbyRaw, setNearbyRaw] = useState<NearbyRec[]>([])
  const [nearbyLoading, setNearbyLoading] = useState(false)
  const [anchorCoords, setAnchorCoords] = useState<{ lat: number; lon: number } | null>(null)
  const nearbyCacheRef = useRef<Record<string, { recs: NearbyRec[]; anchor: { lat: number; lon: number } | null }>>({})

  const { items, addStop, removeStop, updateStop, moveWithinDay, moveToDay } = useItinerary(room.id, sessionId)

  // Wczytaj zapisane analizy dni (+ realtime).
  useEffect(() => {
    const load = () =>
      supabase.from('day_insights').select('*').eq('room_id', room.id).then(({ data }) => {
        const map: Record<number, { signature: string; payload: DayInsightPayload }> = {}
        ;(data || []).forEach((row: any) => { map[row.day_index] = { signature: row.signature, payload: row.payload } })
        setInsightsByDay(map)
      })
    load()
    const channel = supabase
      .channel(`insights:${room.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'day_insights', filter: `room_id=eq.${room.id}` }, load)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [room.id])

  // Wczytaj bazy dni (+ realtime).
  useEffect(() => {
    const load = () =>
      supabase.from('day_meta').select('*').eq('room_id', room.id).then(({ data }) => {
        const map: Record<number, DayMeta> = {}
        ;(data || []).forEach((row: any) => { map[row.day_index] = row as DayMeta })
        setDayMetaByDay(map)
      })
    load()
    const channel = supabase
      .channel(`daymeta:${room.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'day_meta', filter: `room_id=eq.${room.id}` }, load)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [room.id])

  // Zapisane miejsca ekipy (+ realtime, żeby picker był aktualny).
  useEffect(() => {
    const load = () =>
      supabase.from('saved_places').select('*').eq('room_id', room.id).then(({ data }) => {
        setSavedPlaces((data as SavedPlace[]) || [])
      })
    load()
    const channel = supabase
      .channel(`saved_for_map:${room.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'saved_places', filter: `room_id=eq.${room.id}` }, load)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [room.id])

  // Liczba dni + przystanki wybranego dnia.
  const maxDayIndexUsed = items.reduce((m, it) => Math.max(m, it.day_index), 0)
  const days = tripDayCount(room, maxDayIndexUsed, extraDays)
  const dayItems = useMemo(
    () => items.filter((it) => it.day_index === selectedDay).sort((a, b) => a.position - b.position),
    [items, selectedDay],
  )
  const dayCounts = useMemo(() => {
    const arr = new Array(days).fill(0)
    items.forEach((it) => { if (it.day_index < days) arr[it.day_index]++ })
    return arr
  }, [items, days])

  // Inicjalizacja mapy + biblioteki tras (raz). Jasna mapa (styl domyślny Google).
  useEffect(() => {
    if (!GMAPS_KEY) { setLoadError('no-key'); return }
    let cancelled = false
    setOptions({ key: GMAPS_KEY, v: 'weekly' })

    Promise.all([importLibrary('maps'), importLibrary('routes')])
      .then(([{ Map }, { Route }]) => {
        if (cancelled || !mapRef.current || mapInstanceRef.current) return
        const map = new Map(mapRef.current, {
          center: { lat: 46.15, lng: 14.99 },
          zoom: 7,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: 'greedy',
        })
        mapInstanceRef.current = map
        routeClassRef.current = Route
        setMapReady(true)
      })
      .catch(() => { if (!cancelled) setLoadError('load-failed') })

    return () => {
      cancelled = true
      stopMarkersRef.current.forEach((m) => m.setMap(null))
      savedMarkersRef.current.forEach((m) => m.setMap(null))
      recMarkersRef.current.forEach((m) => m.setMap(null))
      stopMarkersRef.current = []
      savedMarkersRef.current = []
      recMarkersRef.current = []
      routePolylineRef.current?.setMap(null)
      routePolylineRef.current = null
      routeClassRef.current = null
      mapInstanceRef.current = null
    }
  }, [])

  // Faint markery wszystkich zapisanych miejsc (kontekst na mapie).
  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map || !mapReady) return
    savedMarkersRef.current.forEach((m) => m.setMap(null))
    savedMarkersRef.current = []
    savedPlaces.forEach((sp) => {
      const c = placeCoords(sp)
      if (!c) return
      const marker = new google.maps.Marker({
        position: { lat: c.lat, lng: c.lon },
        map,
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 5, fillColor: '#2cc4ff', fillOpacity: 0.6, strokeColor: '#0c2733', strokeWeight: 1 },
        title: sp.place_name,
        zIndex: 1,
      })
      savedMarkersRef.current.push(marker)
    })
  }, [savedPlaces, mapReady])

  // Trasa wybranego dnia (nowe Routes API) + numerowane markery.
  const routeKey = dayItems.map((it) => `${it.lat},${it.lon}`).join('|')
  useEffect(() => {
    const map = mapInstanceRef.current
    const Route = routeClassRef.current
    if (!map || !mapReady || !Route) return
    let cancelled = false

    // Wyczyść poprzednie numerowane markery + trasę.
    stopMarkersRef.current.forEach((m) => m.setMap(null))
    stopMarkersRef.current = []
    routePolylineRef.current?.setMap(null)
    routePolylineRef.current = null

    const pts = dayItems.filter((it) => it.lat != null && it.lon != null) as (ItineraryItem & { lat: number; lon: number })[]

    const bounds = new google.maps.LatLngBounds()
    pts.forEach((it, i) => {
      bounds.extend({ lat: it.lat, lng: it.lon })
      const marker = new google.maps.Marker({
        position: { lat: it.lat, lng: it.lon },
        map,
        label: { text: String(i + 1), color: '#fff', fontSize: '11px', fontWeight: 'bold' },
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 12, fillColor: '#3d7f41', fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 2 },
        title: it.place_name,
        zIndex: 10,
      })
      stopMarkersRef.current.push(marker)
    })

    if (pts.length < 2) {
      setLegs([])
      setRouteLoading(false)
      if (pts.length === 1) { map.panTo({ lat: pts[0].lat, lng: pts[0].lon }); map.setZoom(11) }
      return
    }

    setRouteLoading(true)
    Route.computeRoutes({
      origin: { lat: pts[0].lat, lng: pts[0].lon },
      destination: { lat: pts[pts.length - 1].lat, lng: pts[pts.length - 1].lon },
      intermediates: pts.slice(1, -1).map((it) => ({ location: { lat: it.lat, lng: it.lon } })),
      travelMode: 'DRIVING',
      fields: ['legs', 'path', 'viewport'],
    })
      .then(({ routes }) => {
        if (cancelled) return
        setRouteLoading(false)
        const route = routes?.[0]
        if (!route) { setLegs([]); map.fitBounds(bounds, 56); return }

        // Narysuj trasę.
        const path = (route.path || []).map((p) => ({ lat: p.lat, lng: p.lng }))
        if (path.length) {
          routePolylineRef.current = new google.maps.Polyline({
            path, map, strokeColor: '#3d7f41', strokeOpacity: 0.9, strokeWeight: 4, zIndex: 5,
          })
        }
        // Odcinki: dystans + czas jazdy.
        const rLegs = route.legs || []
        setLegs(rLegs.map((l) => ({ distanceText: fmtKm(l.distanceMeters || 0), durationMin: Math.round((l.durationMillis || 0) / 60000) })))
        const vp = route.viewport
        if (vp) map.fitBounds(vp, 56)
        else map.fitBounds(bounds, 56)
      })
      .catch(() => {
        if (cancelled) return
        setRouteLoading(false)
        setLegs([])
        map.fitBounds(bounds, 56)
      })

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey, mapReady])

  const focusPlace = useCallback((lat: number, lon: number) => {
    const map = mapInstanceRef.current
    if (!map) return
    map.panTo({ lat, lng: lon })
    map.setZoom(12)
  }, [])

  // Bieżąca analiza dnia + czy jest aktualna względem składu dnia.
  const currentSig = daySignature(dayItems)
  const dayInsight = insightsByDay[selectedDay]
  const insightFresh = !!dayInsight && dayInsight.signature === currentSig

  const analyzeDay = useCallback(async () => {
    if (insightLoading || dayItems.length === 0) return
    setInsightLoading(true)
    try {
      const dayDate = dateForDay(room.start_date, selectedDay)
      const first = dayItems.find((it) => it.lat != null && it.lon != null)
      let weather = null
      if (first && dayDate) weather = await fetchDayWeather(first.lat!, first.lon!, dayDate)

      const res = await fetch('/api/day-insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stops: dayItems.map((it) => ({
            name: it.place_name,
            lat: it.lat,
            lon: it.lon,
            openingLine: openingLineForDate(it.opening_hours, dayDate),
            durationMin: it.duration_min,
          })),
          legs,
          weather,
          activities: (myPrefs?.activities as string[]) || [],
          date: dayDate ? dayDate.toISOString().split('T')[0] : '',
          cityHint: room.end_city || '',
        }),
      })
      if (!res.ok) return
      const payload: DayInsightPayload = await res.json()
      const signature = daySignature(dayItems)
      // Zapis do cache (współdzielony) — realtime zaktualizuje stan.
      await supabase
        .from('day_insights')
        .upsert({ room_id: room.id, day_index: selectedDay, signature, payload, updated_at: new Date().toISOString() }, { onConflict: 'room_id,day_index' })
      setInsightsByDay((prev) => ({ ...prev, [selectedDay]: { signature, payload } }))
    } finally {
      setInsightLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insightLoading, dayItems, legs, selectedDay, room.id, room.start_date, room.end_city, myPrefs])

  // ——— Baza dnia (Faza 3.4): miasto, promień, kategorie ———
  // Pojedynczy wybór (Faza 3.6): domyślnie JEDNA kategoria z preferencji ekipy.
  const defaultCats = useMemo(() => {
    const out: string[] = []
    ;((myPrefs?.activities as string[]) || []).forEach((a) => (PREF_TO_CATS[a] || []).forEach((c) => { if (!out.includes(c)) out.push(c) }))
    return [out[0] || 'restaurant']
  }, [myPrefs])
  const metaRow = dayMetaByDay[selectedDay]
  const dayCity = metaRow?.city || ''
  const dayCountry = metaRow?.country || ''
  const dayRadius = metaRow?.radius || 40
  const dayCategories = useMemo(
    () => (metaRow?.categories?.length ? metaRow.categories : defaultCats),
    [metaRow, defaultCats],
  )

  const saveMeta = useCallback(
    async (patch: Partial<Pick<DayMeta, 'city' | 'country' | 'radius' | 'categories'>>) => {
      const base = { city: dayCity, country: dayCountry, radius: dayRadius, categories: dayCategories }
      const next = { ...base, ...patch }
      setDayMetaByDay((prev) => ({
        ...prev,
        [selectedDay]: { ...(prev[selectedDay] || {}), room_id: room.id, day_index: selectedDay, ...next } as DayMeta,
      }))
      await supabase
        .from('day_meta')
        .upsert({ room_id: room.id, day_index: selectedDay, ...next, updated_at: new Date().toISOString() }, { onConflict: 'room_id,day_index' })
    },
    [dayCity, dayCountry, dayRadius, dayCategories, room.id, selectedDay],
  )

  const setDayCity = useCallback((city: string, country: string) => { saveMeta({ city, country }) }, [saveMeta])
  const setDayRadius = useCallback((radius: number) => { saveMeta({ radius }) }, [saveMeta])
  // Pojedynczy wybór: stuknięcie kategorii zastępuje poprzednią i od razu szuka.
  const selectCategory = useCallback((cat: string) => {
    saveMeta({ categories: [cat] })
  }, [saveMeta])

  // Eksploracja wokół bazy dnia (discover po mieście + promieniu + kategoriach).
  const exploreKey = dayCity ? `${dayCity}|${dayCountry}|r${dayRadius}|${[...dayCategories].sort().join(',')}` : ''
  useEffect(() => {
    if (!exploreKey || !dayCity) { setNearbyRaw([]); setAnchorCoords(null); return }
    const cached = nearbyCacheRef.current[exploreKey]
    if (cached) { setNearbyRaw(cached.recs); setAnchorCoords(cached.anchor); return }
    let cancelled = false
    const t = setTimeout(async () => {
      setNearbyLoading(true)
      try {
        const res = await fetch('/api/discover', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            baseCity: dayCity,
            country: dayCountry,
            radius: dayRadius,
            categories: dayCategories,
            sort: 'match',
          }),
        })
        if (!res.ok || cancelled) return
        const data = await res.json()
        const recs: NearbyRec[] = (data.places || [])
          .filter((p: any) => typeof p.lat === 'number' && typeof p.lon === 'number')
          .map((p: any) => ({
            name: p.name, googlePlaceId: p.googlePlaceId, lat: p.lat, lon: p.lon,
            tags: p.tags || [], openingHours: p.openingHours, googleRating: p.googleRating,
            googleTotalRatings: p.googleTotalRatings, distanceFromBase: p.distanceFromBase,
            recentReviewHighlights: p.recentReviewHighlights, sources: p.sources,
            mentionCount: p.mentionCount, isOpen: p.isOpen, website: p.website,
            address: p.address, curated: p.curated,
          }))
        const anchor = typeof data.baseLat === 'number' && typeof data.baseLon === 'number'
          ? { lat: data.baseLat, lon: data.baseLon } : null
        if (cancelled) return
        nearbyCacheRef.current[exploreKey] = { recs, anchor }
        setNearbyRaw(recs)
        setAnchorCoords(anchor)
      } finally {
        if (!cancelled) setNearbyLoading(false)
      }
    }, 600)
    return () => { cancelled = true; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exploreKey])

  // Wyklucz to, co już jest w planie lub zapisane; pokaż maks. 8.
  const nearby = useMemo(() => {
    const names = new Set<string>()
    const ids = new Set<string>()
    items.forEach((it) => { names.add(it.place_name.toLowerCase()); if (it.place_id) ids.add(it.place_id) })
    savedPlaces.forEach((sp) => { names.add(sp.place_name.toLowerCase()); const pid = sp.place_data?.place_id; if (pid) ids.add(pid) })
    return nearbyRaw.filter((r) => !ids.has(r.googlePlaceId) && !names.has(r.name.toLowerCase())).slice(0, 8)
  }, [nearbyRaw, items, savedPlaces])

  // Markery polecajek (pomarańczowe) + centrowanie mapy na bazie pustego dnia.
  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map || !mapReady) return
    recMarkersRef.current.forEach((m) => m.setMap(null))
    recMarkersRef.current = []
    nearby.forEach((r) => {
      const marker = new google.maps.Marker({
        position: { lat: r.lat, lng: r.lon },
        map,
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 6, fillColor: '#f59e0b', fillOpacity: 0.9, strokeColor: '#ffffff', strokeWeight: 1 },
        title: r.name,
        zIndex: 3,
      })
      recMarkersRef.current.push(marker)
    })
  }, [nearby, mapReady])

  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map || !mapReady || dayItems.length > 0 || !anchorCoords) return
    map.panTo({ lat: anchorCoords.lat, lng: anchorCoords.lon })
    map.setZoom(10)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorCoords, mapReady, dayItems.length])

  const addNearby = useCallback((rec: NearbyRec) => {
    addStop(selectedDay, {
      place_name: rec.name,
      place_id: rec.googlePlaceId,
      lat: rec.lat,
      lon: rec.lon,
      opening_hours: rec.openingHours ?? null,
      tags: rec.tags || [],
    })
  }, [addStop, selectedDay])

  const handleAddDay = () => { setExtraDays((v) => v + 1); setSelectedDay(days) }
  const handleRemoveDay = (d: number) => {
    setExtraDays((v) => Math.max(0, v - 1))
    if (selectedDay >= d) setSelectedDay((s) => Math.max(0, s - 1))
  }

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 112px)' }}>
      {/* Mapa */}
      <div style={{ height: '42%', position: 'relative', minHeight: '240px' }}>
        <div ref={mapRef} style={{ width: '100%', height: '100%' }} />

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

        {!mapReady && !loadError && GMAPS_KEY && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1c1917', zIndex: 10 }}>
            <div className="text-center">
              <div className="text-4xl mb-2 animate-pulse">🗺️</div>
              <p className="text-stone-500 text-sm">Ładowanie mapy...</p>
            </div>
          </div>
        )}

        {mapReady && (
          <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 5 }} className="bg-stone-900/90 backdrop-blur-sm border border-stone-700 rounded-xl p-2 space-y-1">
            <div className="flex items-center gap-2 text-xs text-stone-300">
              <div className="w-3 h-3 rounded-full bg-forest-600" /> Trasa dnia {selectedDay + 1}
            </div>
            <div className="flex items-center gap-2 text-xs text-stone-300">
              <div className="w-3 h-3 rounded-full bg-water-400" /> Zapisane
            </div>
            <div className="flex items-center gap-2 text-xs text-stone-300">
              <div className="w-3 h-3 rounded-full" style={{ background: '#f59e0b' }} /> Polecane
            </div>
          </div>
        )}
      </div>

      {/* Planer dni */}
      <div className="flex-1 overflow-y-auto">
        <DayPlanner
          startDate={room.start_date}
          days={days}
          selectedDay={selectedDay}
          onSelectDay={setSelectedDay}
          onAddDay={handleAddDay}
          onRemoveDay={handleRemoveDay}
          dayCounts={dayCounts}
          dayItems={dayItems}
          legs={legs}
          routeLoading={routeLoading}
          savedPlaces={savedPlaces}
          onAddStop={(stop) => addStop(selectedDay, stop)}
          onRemoveStop={removeStop}
          onMoveWithinDay={moveWithinDay}
          onMoveToDay={moveToDay}
          onUpdateStop={updateStop}
          onFocusPlace={focusPlace}
          insight={dayInsight?.payload || null}
          insightFresh={insightFresh}
          insightLoading={insightLoading}
          onAnalyze={analyzeDay}
          nearby={nearby}
          nearbyLoading={nearbyLoading}
          onAddNearby={addNearby}
          dayCity={dayCity}
          dayRadius={dayRadius}
          dayCategories={dayCategories}
          onSetCity={setDayCity}
          onSetRadius={setDayRadius}
          onSelectCategory={selectCategory}
        />
      </div>
    </div>
  )
}
