'use client'

import { useEffect, useState, useRef, useMemo, useCallback } from 'react'
import { setOptions, importLibrary } from '@googlemaps/js-api-loader'
import { Room, UserPreference, SavedPlace, ItineraryItem } from '@/lib/supabase'
import { supabase } from '@/lib/supabase'
import { getSessionId } from '@/lib/session'
import { useItinerary } from './useItinerary'
import { tripDayCount } from './itineraryUtils'
import DayPlanner, { Leg } from './DayPlanner'

interface Props {
  room: Room
  myPrefs: UserPreference
}

const GMAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || ''

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

function placeCoords(sp: SavedPlace): { lat: number; lon: number } | null {
  const c = sp.place_data?.coordinates
  if (Array.isArray(c) && typeof c[0] === 'number' && typeof c[1] === 'number') {
    return { lat: c[0], lon: c[1] }
  }
  return null
}

export default function MapTab({ room }: Props) {
  const sessionId = typeof window !== 'undefined' ? getSessionId() : ''

  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<google.maps.Map | null>(null)
  const dirServiceRef = useRef<google.maps.DirectionsService | null>(null)
  const dirRendererRef = useRef<google.maps.DirectionsRenderer | null>(null)
  const stopMarkersRef = useRef<google.maps.Marker[]>([])
  const savedMarkersRef = useRef<google.maps.Marker[]>([])

  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([])
  const [mapReady, setMapReady] = useState(false)
  const [loadError, setLoadError] = useState('')

  const [selectedDay, setSelectedDay] = useState(0)
  const [extraDays, setExtraDays] = useState(0)
  const [legs, setLegs] = useState<Leg[]>([])
  const [routeLoading, setRouteLoading] = useState(false)

  const { items, addStop, removeStop, updateStop, moveWithinDay, moveToDay } = useItinerary(room.id, sessionId)

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

  // Inicjalizacja mapy + biblioteki tras (raz).
  useEffect(() => {
    if (!GMAPS_KEY) { setLoadError('no-key'); return }
    let cancelled = false
    setOptions({ key: GMAPS_KEY, v: 'weekly' })

    Promise.all([importLibrary('maps'), importLibrary('routes')])
      .then(([{ Map }, { DirectionsService, DirectionsRenderer }]) => {
        if (cancelled || !mapRef.current || mapInstanceRef.current) return
        const map = new Map(mapRef.current, {
          center: { lat: 46.15, lng: 14.99 },
          zoom: 7,
          styles: DARK_STYLE,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: 'greedy',
        })
        mapInstanceRef.current = map
        dirServiceRef.current = new DirectionsService()
        dirRendererRef.current = new DirectionsRenderer({
          map,
          suppressMarkers: true,
          preserveViewport: true,
          polylineOptions: { strokeColor: '#3d7f41', strokeOpacity: 0.9, strokeWeight: 4 },
        })
        setMapReady(true)
      })
      .catch(() => { if (!cancelled) setLoadError('load-failed') })

    return () => {
      cancelled = true
      stopMarkersRef.current.forEach((m) => m.setMap(null))
      savedMarkersRef.current.forEach((m) => m.setMap(null))
      stopMarkersRef.current = []
      savedMarkersRef.current = []
      dirRendererRef.current?.setMap(null)
      dirRendererRef.current = null
      dirServiceRef.current = null
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

  // Trasa wybranego dnia (realne Google Directions) + numerowane markery.
  const routeKey = dayItems.map((it) => `${it.lat},${it.lon}`).join('|')
  useEffect(() => {
    const map = mapInstanceRef.current
    const svc = dirServiceRef.current
    const renderer = dirRendererRef.current
    if (!map || !mapReady || !svc || !renderer) return

    // Wyczyść poprzednie numerowane markery.
    stopMarkersRef.current.forEach((m) => m.setMap(null))
    stopMarkersRef.current = []

    const pts = dayItems.filter((it) => it.lat != null && it.lon != null) as (ItineraryItem & { lat: number; lon: number })[]

    // Numerowane markery dla każdego przystanku.
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
      // Brak trasy do narysowania.
      renderer.setMap(null)
      setLegs([])
      setRouteLoading(false)
      if (pts.length === 1) { map.panTo({ lat: pts[0].lat, lng: pts[0].lon }); map.setZoom(11) }
      return
    }

    setRouteLoading(true)
    const origin = { lat: pts[0].lat, lng: pts[0].lon }
    const destination = { lat: pts[pts.length - 1].lat, lng: pts[pts.length - 1].lon }
    const waypoints = pts.slice(1, -1).map((it) => ({ location: { lat: it.lat, lng: it.lon }, stopover: true }))

    svc.route(
      { origin, destination, waypoints, travelMode: google.maps.TravelMode.DRIVING, optimizeWaypoints: false },
      (result, status) => {
        setRouteLoading(false)
        if (status === google.maps.DirectionsStatus.OK && result) {
          renderer.setMap(map)
          renderer.setDirections(result)
          const rLegs = result.routes[0]?.legs || []
          setLegs(rLegs.map((l) => ({ distanceText: l.distance?.text || '—', durationMin: Math.round((l.duration?.value || 0) / 60) })))
          const b = result.routes[0]?.bounds
          if (b) map.fitBounds(b, 56)
        } else {
          // Nie udało się wyznaczyć trasy — pokaż same markery.
          renderer.setMap(null)
          setLegs([])
          map.fitBounds(bounds, 56)
        }
      },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey, mapReady])

  const focusPlace = useCallback((lat: number, lon: number) => {
    const map = mapInstanceRef.current
    if (!map) return
    map.panTo({ lat, lng: lon })
    map.setZoom(12)
  }, [])

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
            <div className="flex items-center gap-2 text-xs text-stone-400">
              <div className="w-3 h-3 rounded-full bg-forest-600" /> Trasa dnia {selectedDay + 1}
            </div>
            <div className="flex items-center gap-2 text-xs text-stone-400">
              <div className="w-3 h-3 rounded-full bg-water-400" /> Zapisane
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
        />
      </div>
    </div>
  )
}
