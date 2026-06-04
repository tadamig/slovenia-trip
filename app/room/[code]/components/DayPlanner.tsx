'use client'

import { useEffect, useMemo, useState } from 'react'
import { ItineraryItem, SavedPlace, DayInsightPayload } from '@/lib/supabase'
import { NewStop } from './useItinerary'
import CityAutocomplete from './CityAutocomplete'
import {
  dateForDay, formatDayDate, openingLineForDate, isOpenAt, OpenState,
  summarizeFeasibility, formatDuration, DAY_BUDGET_MIN,
  fetchDayWeather, weatherEmoji, weatherHint, DayWeather,
} from './itineraryUtils'
import {
  ChevronUp, ChevronDown, Trash2, Plus, Clock, MapPin, Ruler, AlertTriangle, X, Sparkles, Car, Lightbulb, RefreshCw,
  Star, Info, ExternalLink,
} from 'lucide-react'

const ACTIVITY_TAGS: Record<string, string> = {
  sup: '🏄 SUP', trekking: '🥾 Trekking', food: '🍽️ Jedzenie', sunset: '🌅 Widok',
  sightseeing: '🏛️ Zwiedzanie', relax: '🧘 Relaks', photo: '📸 Foto', markets: '🛒 Targi', nightlife: '🍺 Nocne życie',
}

const DURATION_PRESETS = [30, 60, 90, 120, 180]

// Konkretne typy miejsc bazy dnia (Faza 3.5) — zgodne z POI_QUERIES w /api/discover.
const CATEGORIES: { key: string; label: string }[] = [
  { key: 'restaurant', label: '🍴 Restauracje' },
  { key: 'cafe', label: '☕ Kawa' },
  { key: 'bakery', label: '🧁 Cukiernia' },
  { key: 'bar', label: '🍺 Bary' },
  { key: 'icecream', label: '🍦 Lody' },
  { key: 'streetfood', label: '🌭 Street food' },
  { key: 'landmark', label: '🏛️ Zabytki' },
  { key: 'museum', label: '🖼️ Muzea' },
  { key: 'park', label: '🌳 Parki' },
  { key: 'viewpoint', label: '🌄 Widoki' },
  { key: 'water', label: '🏄 SUP / woda' },
  { key: 'trekking', label: '🥾 Trekking' },
  { key: 'markets', label: '🛒 Targi' },
  { key: 'photo', label: '📸 Foto' },
]

// Etykiety konkretnych typów (do tagów na karcie polecajki).
const CAT_LABEL: Record<string, string> = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.label]))

// Licznik opinii → zwięzły zapis (3,5k).
function fmtCount(n?: number): string {
  if (!n) return ''
  return n >= 1000 ? `${(n / 1000).toFixed(1).replace('.', ',')}k` : String(n)
}

export type Leg = { distanceText: string; durationMin: number }

// Polecajka w okolicy dnia (z silnika discover) — pełne dane jak w zakładce Miejsca.
export type NearbyRec = {
  name: string
  googlePlaceId: string
  lat: number
  lon: number
  tags: string[]
  openingHours?: string[]
  googleRating?: number
  googleTotalRatings?: number
  distanceFromBase?: number
  recentReviewHighlights?: string[]
  sources?: { url: string; title: string }[]
  mentionCount?: number
  isOpen?: boolean | null
  website?: string
  address?: string
  curated?: boolean
}

interface Props {
  startDate: string | null
  days: number
  selectedDay: number
  onSelectDay: (d: number) => void
  onAddDay: () => void
  onRemoveDay: (d: number) => void
  dayCounts: number[]            // liczba przystanków w każdym dniu (do badge'y)
  dayItems: ItineraryItem[]      // przystanki wybranego dnia (posortowane)
  legs: Leg[]                    // odcinki między kolejnymi przystankami wybranego dnia
  routeLoading: boolean
  savedPlaces: SavedPlace[]
  onAddStop: (stop: NewStop) => void
  onRemoveStop: (id: string) => void
  onMoveWithinDay: (id: string, dir: -1 | 1) => void
  onMoveToDay: (id: string, dayIndex: number) => void
  onUpdateStop: (id: string, patch: Partial<Pick<ItineraryItem, 'duration_min' | 'start_time'>>) => void
  onFocusPlace: (lat: number, lon: number) => void
  insight: DayInsightPayload | null
  insightFresh: boolean
  insightLoading: boolean
  onAnalyze: () => void
  nearby: NearbyRec[]
  nearbyLoading: boolean
  onAddNearby: (rec: NearbyRec) => void
  dayCity: string
  dayRadius: number
  dayCategories: string[]
  onSetCity: (city: string, country: string) => void
  onSetRadius: (radius: number) => void
  onToggleCategory: (cat: string) => void
}

function savedToStop(sp: SavedPlace): NewStop {
  const c = sp.place_data?.coordinates
  return {
    place_name: sp.place_name,
    place_id: sp.place_data?.place_id ?? null,
    lat: Array.isArray(c) ? c[0] : null,
    lon: Array.isArray(c) ? c[1] : null,
    saved_place_id: sp.id,
    opening_hours: sp.place_data?.opening_hours ?? null,
    tags: (sp.tags as string[]) || [],
  }
}

function navUrl(lat: number | null, lon: number | null, placeId: string | null): string {
  if (lat == null || lon == null) return '#'
  return placeId
    ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&destination_place_id=${placeId}`
    : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`
}

function openBadge(state: OpenState, line: string | null) {
  if (state === 'open') return <span className="text-emerald-400">🟢 otwarte · {line}</span>
  if (state === 'closed') return <span className="text-rose-400">🔴 {line || 'zamknięte'}</span>
  if (line) return <span className="text-stone-500">🕒 {line}</span>
  return null
}

export default function DayPlanner({
  startDate, days, selectedDay, onSelectDay, onAddDay, onRemoveDay, dayCounts,
  dayItems, legs, routeLoading, savedPlaces,
  onAddStop, onRemoveStop, onMoveWithinDay, onMoveToDay, onUpdateStop, onFocusPlace,
  insight, insightFresh, insightLoading, onAnalyze,
  nearby, nearbyLoading, onAddNearby,
  dayCity, dayRadius, dayCategories, onSetCity, onSetRadius, onToggleCategory,
}: Props) {
  const [picker, setPicker] = useState(false)
  const [weather, setWeather] = useState<DayWeather | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  const [recOpen, setRecOpen] = useState<Set<string>>(new Set())
  const toggleRec = (id: string) =>
    setRecOpen((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const dayDate = dateForDay(startDate, selectedDay)

  // Pogoda dnia — dla pierwszego przystanku ze współrzędnymi.
  useEffect(() => {
    let cancelled = false
    setWeather(null)
    const first = dayItems.find((it) => it.lat != null && it.lon != null)
    if (!first || !dayDate) return
    fetchDayWeather(first.lat!, first.lon!, dayDate).then((w) => {
      if (!cancelled) setWeather(w)
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDay, dayItems.map((it) => `${it.lat},${it.lon}`).join('|'), startDate])

  // Wykonalność dnia.
  const feasibility = useMemo(() => {
    const driveMin = legs.reduce((s, l) => s + l.durationMin, 0)
    const visitMin = dayItems.reduce((s, it) => s + (it.duration_min || 0), 0)
    let closedCount = 0
    for (const it of dayItems) {
      const line = openingLineForDate(it.opening_hours, dayDate)
      if (isOpenAt(line, it.start_time) === 'closed') closedCount++
    }
    return summarizeFeasibility(driveMin, visitMin, closedCount)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legs, dayItems, startDate, selectedDay])

  // Miejsca dostępne do dodania (mają współrzędne, jeszcze nie w tym dniu).
  const inDayIds = new Set(dayItems.map((it) => it.saved_place_id).filter(Boolean))
  const addable = savedPlaces.filter((sp) => {
    const c = sp.place_data?.coordinates
    return Array.isArray(c) && typeof c[0] === 'number' && !inDayIds.has(sp.id)
  })

  return (
    <div className="bg-stone-900 border-t border-stone-800">
      {/* Pasek dni */}
      <div className="flex items-center gap-1.5 px-3 py-2.5 overflow-x-auto border-b border-stone-800/70">
        {Array.from({ length: days }).map((_, d) => {
          const date = dateForDay(startDate, d)
          const active = d === selectedDay
          const cnt = dayCounts[d] || 0
          return (
            <button
              key={d}
              onClick={() => onSelectDay(d)}
              className={`flex-shrink-0 flex flex-col items-center px-3 py-1.5 rounded-xl text-center transition-all border ${
                active
                  ? 'bg-gradient-to-br from-forest-600/80 to-water-600/70 text-white border-white/20'
                  : 'bg-stone-800/40 text-stone-400 border-stone-700/30 hover:text-stone-200'
              }`}
            >
              <span className="text-xs font-semibold leading-none">Dzień {d + 1}{cnt > 0 ? ` · ${cnt}` : ''}</span>
              {date && (
                <span className="text-[10px] opacity-80 leading-none mt-0.5">
                  {date.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' })}
                </span>
              )}
            </button>
          )
        })}
        <button
          onClick={onAddDay}
          className="flex-shrink-0 w-8 h-8 rounded-xl bg-stone-800/40 border border-stone-700/30 text-stone-400 hover:text-stone-200 flex items-center justify-center"
          title="Dodaj dzień"
        >
          <Plus className="w-4 h-4" />
        </button>
        {/* Usuń ostatni dzień — tylko gdy pusty (nie kasujemy zaplanowanych przystanków) */}
        {days > 1 && (dayCounts[days - 1] || 0) === 0 && (
          <button
            onClick={() => onRemoveDay(days - 1)}
            className="flex-shrink-0 w-8 h-8 rounded-xl bg-stone-800/40 border border-stone-700/30 text-stone-500 hover:text-rose-400 flex items-center justify-center"
            title="Usuń ostatni (pusty) dzień"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Nagłówek dnia: data + pogoda + wykonalność */}
      <div className="px-4 pt-3 pb-1 flex items-center justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <p className="text-stone-200 text-sm font-semibold capitalize truncate">
            {dayDate ? formatDayDate(dayDate) : `Dzień ${selectedDay + 1}`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {weather && (
            <span className="text-xs text-stone-300 bg-stone-800/60 border border-stone-700/40 rounded-full px-2.5 py-1">
              {weatherEmoji(weather.weatherCode)} {weather.tempMax}° / {weather.tempMin}°
              {weather.precipitation >= 0.5 ? ` · 💧${weather.precipitation.toFixed(1)}mm` : ''}
            </span>
          )}
          {dayItems.length > 0 && (
            <span
              className={`text-xs rounded-full px-2.5 py-1 border ${
                feasibility.overBudget
                  ? 'text-amber-400 bg-amber-900/20 border-amber-700/40'
                  : 'text-emerald-400 bg-emerald-900/20 border-emerald-700/30'
              }`}
            >
              {feasibility.overBudget ? '⚠️ ' : '✅ '}
              {formatDuration(feasibility.totalMin)} dnia
            </span>
          )}
        </div>
      </div>

      {/* Ostrzeżenia */}
      {dayItems.length > 0 && (feasibility.overBudget || feasibility.closedCount > 0) && (
        <div className="px-4 pb-1 space-y-1">
          {feasibility.overBudget && (
            <p className="text-xs text-amber-400/90 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
              Dzień przeładowany (~{formatDuration(feasibility.totalMin)} przy budżecie {formatDuration(DAY_BUDGET_MIN)}) —
              rozważ przeniesienie przystanku na inny dzień.
            </p>
          )}
          {feasibility.closedCount > 0 && (
            <p className="text-xs text-rose-400/90 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
              {feasibility.closedCount} {feasibility.closedCount === 1 ? 'miejsce' : 'miejsca'} mogą być zamknięte o planowanej porze.
            </p>
          )}
        </div>
      )}

      {/* Lista przystanków dnia */}
      <div className="px-4 pt-2 pb-3">
        {dayItems.length === 0 ? (
          <p className="text-stone-600 text-xs bg-stone-800/30 border border-dashed border-stone-700/40 rounded-xl px-3 py-4 text-center">
            Pusty dzień. Ustaw poniżej miasto/okolicę dnia, wybierz miejsca z podpowiedzi — policzę trasę, czasy i sprawdzę, czy się wyrobicie.
          </p>
        ) : (
          <div className="space-y-1.5">
            {dayItems.map((it, i) => {
              const line = openingLineForDate(it.opening_hours, dayDate)
              const openState = isOpenAt(line, it.start_time)
              const leg = legs[i] // odcinek DO następnego przystanku
              return (
                <div key={it.id}>
                  <div className="bg-stone-800/40 border border-stone-700/30 rounded-xl px-3 py-2.5">
                    <div className="flex items-start gap-2.5">
                      <button
                        onClick={() => it.lat != null && it.lon != null && onFocusPlace(it.lat, it.lon)}
                        className="w-6 h-6 rounded-full bg-forest-600 flex items-center justify-center text-xs font-bold text-white flex-shrink-0 mt-0.5"
                        title="Pokaż na mapie"
                      >
                        {i + 1}
                      </button>
                      <button onClick={() => toggleExpand(it.id)} className="flex-1 min-w-0 text-left">
                        <p className="text-stone-100 text-sm font-medium truncate flex items-center gap-1">
                          {it.place_name}
                          <Info className="w-3 h-3 text-stone-500 flex-shrink-0" />
                        </p>
                        {(it.tags as string[])?.length > 0 && (
                          <p className="text-stone-500 text-xs truncate">
                            {(it.tags as string[]).map((t) => CAT_LABEL[t] || ACTIVITY_TAGS[t] || t).join(' · ')}
                          </p>
                        )}
                        <p className="text-xs mt-0.5">{openBadge(openState, line)}</p>
                      </button>
                      {/* Reorder + usuń */}
                      <div className="flex flex-col items-center gap-0.5 flex-shrink-0">
                        <button
                          onClick={() => onMoveWithinDay(it.id, -1)}
                          disabled={i === 0}
                          className="text-stone-500 hover:text-stone-200 disabled:opacity-25"
                        >
                          <ChevronUp className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => onMoveWithinDay(it.id, 1)}
                          disabled={i === dayItems.length - 1}
                          className="text-stone-500 hover:text-stone-200 disabled:opacity-25"
                        >
                          <ChevronDown className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Czas zwiedzania + godzina startu + przenieś do dnia */}
                    <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                      <Clock className="w-3 h-3 text-stone-600" />
                      {DURATION_PRESETS.map((m) => (
                        <button
                          key={m}
                          onClick={() => onUpdateStop(it.id, { duration_min: m })}
                          className={`text-[11px] px-1.5 py-0.5 rounded-md border ${
                            (it.duration_min || 0) === m
                              ? 'bg-forest-600/70 text-white border-forest-500/50'
                              : 'bg-stone-800/60 text-stone-400 border-stone-700/40 hover:text-stone-200'
                          }`}
                        >
                          {m < 60 ? `${m}m` : `${m / 60}h`}
                        </button>
                      ))}
                      <input
                        type="time"
                        value={it.start_time || ''}
                        onChange={(e) => onUpdateStop(it.id, { start_time: e.target.value || null })}
                        className="text-[11px] bg-stone-800/60 text-stone-300 border border-stone-700/40 rounded-md px-1.5 py-0.5 ml-auto"
                        title="Planowana godzina"
                      />
                      <select
                        value={selectedDay}
                        onChange={(e) => onMoveToDay(it.id, parseInt(e.target.value, 10))}
                        className="text-[11px] bg-stone-800/60 text-stone-400 border border-stone-700/40 rounded-md px-1 py-0.5"
                        title="Przenieś do dnia"
                      >
                        {Array.from({ length: days }).map((_, d) => (
                          <option key={d} value={d}>
                            Dz {d + 1}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => onRemoveStop(it.id)}
                        className="text-stone-600 hover:text-rose-400"
                        title="Usuń z dnia"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Rozwinięte szczegóły miejsca (Faza 3.3) */}
                    {expanded.has(it.id) && (() => {
                      const sp = savedPlaces.find((s) => s.id === it.saved_place_id)
                      const pd = sp?.place_data
                      const rating = pd?.google_rating
                      const desc = pd?.description
                      const address = pd?.address
                      const aiTip = insight?.briefing?.stops.find((s) => s.name.toLowerCase() === it.place_name.toLowerCase())?.tip
                      const hours = (it.opening_hours as string[] | null) || pd?.opening_hours || null
                      return (
                        <div className="mt-2 pt-2 border-t border-stone-700/40 space-y-1.5 text-xs">
                          {(rating || address) && (
                            <p className="text-stone-400 flex items-center gap-2 flex-wrap">
                              {rating && <span className="flex items-center gap-0.5 text-amber-400"><Star className="w-3 h-3" /> {rating}</span>}
                              {address && <span className="truncate">{address}</span>}
                            </p>
                          )}
                          {desc && <p className="text-stone-400 leading-relaxed">{desc}</p>}
                          {aiTip && (
                            <p className="text-stone-300 flex gap-1.5">
                              <Lightbulb className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" /> <span>{aiTip}</span>
                            </p>
                          )}
                          {hours && hours.length > 0 && (
                            <div className="text-stone-500">
                              <p className="text-stone-400 font-medium mb-0.5">Godziny otwarcia:</p>
                              {hours.map((h, k) => <p key={k} className="leading-tight">{h}</p>)}
                            </div>
                          )}
                          {it.lat != null && it.lon != null && (
                            <a
                              href={navUrl(it.lat, it.lon, it.place_id)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-water-400 hover:text-water-300 font-medium"
                            >
                              <ExternalLink className="w-3 h-3" /> Nawiguj w Google Maps
                            </a>
                          )}
                        </div>
                      )
                    })()}
                  </div>

                  {/* Odcinek do następnego przystanku */}
                  {i < dayItems.length - 1 && (
                    <div className="flex items-center gap-2 px-3 py-1 text-stone-600 text-xs">
                      <div className="w-px h-3 bg-stone-700 ml-2.5" />
                      {routeLoading && !leg ? (
                        <span className="text-stone-600 animate-pulse">liczę trasę…</span>
                      ) : leg ? (
                        <>
                          <Ruler className="w-3 h-3" /> {leg.distanceText}
                          <Clock className="w-3 h-3 ml-1" /> {formatDuration(leg.durationMin)} jazdy
                        </>
                      ) : (
                        <span className="text-stone-700">— brak trasy</span>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Baza dnia + eksploracja okolicy (Faza 3.4) */}
        <div className="mt-3 bg-stone-800/30 border border-stone-700/40 rounded-xl p-3 space-y-3">
          <CityAutocomplete
            value={dayCity}
            onChange={(c, country) => onSetCity(c, country)}
            label="📍 Gdzie jesteście tego dnia?"
            placeholder="np. Budapeszt, Bled, Ljubljana…"
          />

          {dayCity ? (
            <>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-stone-500 font-medium">Szukaj w promieniu</span>
                  <span className="text-xs text-water-400 font-semibold">{dayRadius} km</span>
                </div>
                <input
                  type="range" min={10} max={80} step={5} value={dayRadius}
                  onChange={(e) => onSetRadius(parseInt(e.target.value, 10))}
                  className="w-full accent-water-500"
                />
              </div>

              <div className="flex flex-wrap gap-1.5">
                {CATEGORIES.map((c) => {
                  const on = dayCategories.includes(c.key)
                  return (
                    <button
                      key={c.key}
                      onClick={() => onToggleCategory(c.key)}
                      className={`text-[11px] px-2 py-1 rounded-full border transition-colors ${
                        on
                          ? 'bg-forest-600/70 text-white border-forest-500/50'
                          : 'bg-stone-800/60 text-stone-400 border-stone-700/40 hover:text-stone-200'
                      }`}
                    >
                      {c.label}
                    </button>
                  )
                })}
              </div>

              <div>
                <p className="text-xs text-water-400 font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" /> W okolicy: {dayCity}
                </p>
                {nearbyLoading && nearby.length === 0 ? (
                  <div className="space-y-1.5">
                    {[0, 1, 2].map((i) => <div key={i} className="h-12 bg-stone-800/40 rounded-xl animate-pulse" />)}
                  </div>
                ) : nearby.length === 0 ? (
                  <p className="text-stone-600 text-xs">Brak nowych podpowiedzi — zmień kategorie albo zwiększ promień.</p>
                ) : (
                  <div className="space-y-1.5">
                    {nearby.map((r) => {
                      const open = recOpen.has(r.googlePlaceId)
                      const hasDetails = !!(r.recentReviewHighlights?.length || r.sources?.length || r.website || r.address)
                      return (
                        <div key={r.googlePlaceId} className="bg-stone-800/40 border border-stone-700/30 rounded-xl px-3 py-2.5">
                          <div className="flex items-start gap-2.5">
                            <MapPin className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                              <p className="text-stone-200 text-sm font-medium truncate">{r.name}</p>
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 text-[11px]">
                                {r.googleRating != null && (
                                  <span className="text-amber-400">⭐ {r.googleRating}{r.googleTotalRatings ? ` (${fmtCount(r.googleTotalRatings)})` : ''}</span>
                                )}
                                {r.isOpen != null && (
                                  <span className={r.isOpen ? 'text-emerald-400' : 'text-rose-400'}>{r.isOpen ? 'Otwarte' : 'Zamknięte'}</span>
                                )}
                                {r.distanceFromBase != null && <span className="text-stone-500">{r.distanceFromBase} km</span>}
                              </div>
                              <div className="flex flex-wrap items-center gap-1 mt-1">
                                {r.sources?.length ? (
                                  <span className="text-[10px] text-amber-300/90 bg-amber-900/20 border border-amber-700/30 rounded-full px-1.5 py-0.5">
                                    📚 Polecane w {r.sources.length} {r.sources.length === 1 ? 'blogu' : 'blogach'}
                                  </span>
                                ) : null}
                                {r.mentionCount ? (
                                  <span className="text-[10px] text-stone-400 bg-stone-900/50 border border-stone-700/40 rounded-full px-1.5 py-0.5">wspomniany {r.mentionCount}×</span>
                                ) : null}
                                {(r.tags || []).slice(0, 3).map((t) => (
                                  <span key={t} className="text-[10px] text-stone-400 bg-stone-900/50 border border-stone-700/40 rounded-full px-1.5 py-0.5">{CAT_LABEL[t] || ACTIVITY_TAGS[t] || t}</span>
                                ))}
                              </div>
                            </div>
                            <button onClick={() => onAddNearby(r)} className="text-amber-400 hover:text-amber-300 flex-shrink-0 mt-0.5" title="Dodaj do dnia">
                              <Plus className="w-4 h-4" />
                            </button>
                          </div>

                          {hasDetails && (
                            <button onClick={() => toggleRec(r.googlePlaceId)} className="mt-1.5 text-[11px] text-water-400 hover:text-water-300 flex items-center gap-1">
                              <Info className="w-3 h-3" /> {open ? 'Ukryj szczegóły' : 'Szczegóły miejsca'}
                            </button>
                          )}
                          {open && (
                            <div className="mt-1.5 space-y-1.5 text-[11px]">
                              {r.address && <p className="text-stone-500">{r.address}</p>}
                              {r.recentReviewHighlights?.length ? (
                                <div className="space-y-1">
                                  {r.recentReviewHighlights.slice(0, 2).map((h, k) => (
                                    <p key={k} className="text-stone-400 italic">{h}</p>
                                  ))}
                                </div>
                              ) : null}
                              {r.sources?.length ? (
                                <div className="space-y-0.5">
                                  <p className="text-stone-500 font-medium">Źródła:</p>
                                  {r.sources.slice(0, 3).map((s, k) => (
                                    <a key={k} href={s.url} target="_blank" rel="noopener noreferrer" className="block text-water-400 hover:text-water-300 truncate">
                                      🔗 {s.title || s.url}
                                    </a>
                                  ))}
                                </div>
                              ) : null}
                              {r.website && (
                                <a href={r.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-water-400 hover:text-water-300">
                                  <ExternalLink className="w-3 h-3" /> Strona
                                </a>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </>
          ) : (
            <p className="text-stone-500 text-xs">
              Ustaw miasto/okolicę tego dnia — podpowiem ciekawe miejsca w pobliżu (do 80 km), a Ty dorzucisz je wprost do planu.
            </p>
          )}
        </div>

        {/* Analiza dnia (AI + parking) */}
        {dayItems.length > 0 && (
          <div className="mt-3">
            <button
              onClick={onAnalyze}
              disabled={insightLoading}
              className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-gradient-to-r from-forest-700/40 to-water-700/40 border border-water-700/40 text-water-200 text-sm font-medium hover:border-water-500/60 transition-all disabled:opacity-60"
            >
              {insightLoading ? (
                <><RefreshCw className="w-4 h-4 animate-spin" /> Analizuję dzień…</>
              ) : insight ? (
                insightFresh ? <><RefreshCw className="w-4 h-4" /> Odśwież analizę dnia</> : <><RefreshCw className="w-4 h-4" /> Plan się zmienił — przelicz analizę</>
              ) : (
                <><Sparkles className="w-4 h-4" /> Analiza dnia (AI + parking)</>
              )}
            </button>

            {insight && (
              <div className="mt-2 bg-stone-800/50 border border-stone-700/40 rounded-xl p-3 space-y-3">
                {!insightFresh && (
                  <p className="text-amber-400/90 text-xs flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" /> Analiza dla wcześniejszej wersji dnia — kliknij „przelicz”.
                  </p>
                )}

                {insight.briefing ? (
                  <>
                    {insight.briefing.summary && (
                      <p className="text-stone-200 text-sm leading-relaxed">{insight.briefing.summary}</p>
                    )}
                    {insight.briefing.timing && (
                      <p className="text-stone-300 text-xs flex gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-water-400 flex-shrink-0 mt-0.5" /> <span>{insight.briefing.timing}</span>
                      </p>
                    )}
                    {insight.briefing.feasibility && (
                      <p className="text-stone-300 text-xs flex gap-1.5">
                        <Lightbulb className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" /> <span>{insight.briefing.feasibility}</span>
                      </p>
                    )}
                    {insight.briefing.weather && (
                      <p className="text-stone-400 text-xs">🌦️ {insight.briefing.weather}</p>
                    )}

                    {/* Per przystanek: tip + parking */}
                    {insight.briefing.stops.length > 0 && (
                      <div className="space-y-2 pt-1 border-t border-stone-700/40">
                        {insight.briefing.stops.map((s, i) => {
                          const gp = insight.parking[i]?.spots || []
                          return (
                            <div key={i} className="text-xs">
                              <p className="text-stone-200 font-medium">{i + 1}. {s.name}</p>
                              {s.tip && <p className="text-stone-400 mt-0.5">{s.tip}</p>}
                              {s.parking && (
                                <p className="text-stone-300 mt-0.5 flex gap-1.5">
                                  <Car className="w-3.5 h-3.5 text-forest-400 flex-shrink-0 mt-0.5" /> <span>{s.parking}</span>
                                </p>
                              )}
                              {gp.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {gp.map((p, j) => (
                                    <span key={j} className="text-[11px] bg-stone-900/60 border border-stone-700/40 rounded-full px-2 py-0.5 text-stone-400">
                                      🅿️ {p.name}{p.distanceM != null ? ` · ${p.distanceM} m` : ''}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-stone-400 text-xs">AI chwilowo niedostępne — poniżej same znalezione parkingi.</p>
                )}

                {/* Gdy brak briefu AI, pokaż przynajmniej parkingi z Google */}
                {!insight.briefing && insight.parking.some((p) => p.spots.length > 0) && (
                  <div className="space-y-1.5">
                    {insight.parking.map((p, i) => p.spots.length > 0 && (
                      <div key={i} className="text-xs">
                        <p className="text-stone-300">{p.stop}</p>
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {p.spots.map((s, j) => (
                            <span key={j} className="text-[11px] bg-stone-900/60 border border-stone-700/40 rounded-full px-2 py-0.5 text-stone-400">
                              🅿️ {s.name}{s.distanceM != null ? ` · ${s.distanceM} m` : ''}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Dodawanie miejsc */}
        <button
          onClick={() => setPicker((v) => !v)}
          className="mt-2 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-stone-800/30 border border-dashed border-stone-700/40 text-stone-400 text-xs hover:border-forest-700/50 transition-all"
        >
          <Plus className="w-3.5 h-3.5" /> Dodaj z zapisanych miejsc
        </button>

        {picker && (
          <div className="mt-2 bg-stone-800/60 border border-stone-700/40 rounded-xl p-2">
            <div className="flex items-center justify-between px-1 pb-1.5">
              <p className="text-xs text-stone-400 font-semibold uppercase tracking-wider">Zapisane miejsca</p>
              <button onClick={() => setPicker(false)} className="text-stone-500 hover:text-stone-300">
                <X className="w-4 h-4" />
              </button>
            </div>
            {addable.length === 0 ? (
              <p className="text-stone-600 text-xs px-1 py-2">
                Brak miejsc do dodania. Zapisz miejsca w zakładce „Miejsca” (z lokalizacją), a pojawią się tutaj.
              </p>
            ) : (
              <div className="space-y-1 max-h-56 overflow-y-auto">
                {addable.map((sp) => (
                  <button
                    key={sp.id}
                    onClick={() => { onAddStop(savedToStop(sp)); setPicker(false) }}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg bg-stone-900/50 border border-stone-700/30 text-left hover:border-water-700/40 transition-all"
                  >
                    <MapPin className="w-4 h-4 text-water-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-stone-200 text-xs font-medium truncate">{sp.place_name}</p>
                      <p className="text-stone-500 text-[11px] truncate">
                        {((sp.tags as string[]) || []).map((t) => CAT_LABEL[t] || ACTIVITY_TAGS[t] || t).join(' · ') || 'Zapisane miejsce'}
                      </p>
                    </div>
                    <Plus className="w-4 h-4 text-stone-500 flex-shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Podpowiedź pogodowa */}
        {weather && weatherHint(weather) && (
          <p className="mt-2 text-xs text-stone-400 bg-stone-800/40 border border-stone-700/30 rounded-xl px-3 py-2">
            {weatherHint(weather)}
          </p>
        )}
      </div>
    </div>
  )
}
