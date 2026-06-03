'use client'


// Mapowanie kraju na region dla verify bounds
function countryToRegion(country: string): string {
  const c = country.toLowerCase()
  if (c.includes('hungary') || c.includes('węgry') || c.includes('magyarország')) return 'budapest'
  if (c.includes('slovenia') || c.includes('słowenia') || c.includes('slovenija')) return 'slovenia'
  if (c.includes('croatia') || c.includes('chorwacja') || c.includes('hrvatska')) return 'croatia'
  if (c.includes('austria') || c.includes('austria')) return 'austria'
  if (c.includes('italy') || c.includes('włochy') || c.includes('italia')) return 'italy'
  return 'europe' // fallback — Europa ogólnie
}

import { useState, useEffect } from 'react'
import GlobeAnimation from './GlobeAnimation'
import { supabase, SavedPlace, Room, UserPreference } from '@/lib/supabase'
import { getSessionId, getSessionName } from '@/lib/session'
import { Heart, MessageSquare, Star, MapPin, ExternalLink, ChevronDown, Filter, RefreshCw, Loader2 } from 'lucide-react'

interface Props {
  room: Room
  myPrefs: UserPreference
  allPrefs: UserPreference[]
  prefetched?: { places: any[]; baseLat: number | null; baseLon: number | null } | null
}

interface AIPlace {
  name: string
  description?: string
  whyThisGroup?: string
  groupFitNote?: string
  bestTime?: string
  visitTips?: string
  reviewSummary?: string
  recentReviewHighlights?: string[]
  tags: string[]
  region?: string
  subregion?: string
  lat?: number
  lon?: number
  estimatedCost?: 'free' | 'cheap' | 'moderate' | 'expensive'
  priceLevel?: number
  sourceCount?: number
  sentiment?: string
  distanceFromBase?: number
  localityScore?: number
  authenticityNote?: string
  country?: string
  verified?: boolean
  googleRating?: number
  googleTotalRatings?: number
  googlePlaceId?: string
  isOpen?: boolean | null
  googleAddress?: string
  address?: string
  website?: string
  source?: 'google' // skąd pochodzi
  score?: number // ranking silnika /api/discover (0–100)
  curated?: boolean // czy pochodzi z kuracji DeepSeek
  matchedActivities?: string[]
  blogSources?: { url: string; title: string }[] // źródła blogowe z bazy wiedzy (Layer 0)
  mentionCount?: number // w ilu blogach wspomniane
}

type SearchMode = 'standard' | 'research'

const ACTIVITY_TAGS: Record<string, string> = {
  sup: '🏄 SUP', trekking: '🥾 Trekking', food: '🍽️ Jedzenie',
  sunset: '🌅 Widok', sightseeing: '🏛️ Zwiedzanie', relax: '🧘 Relaks',
  photo: '📸 Foto', markets: '🛒 Targi', nightlife: '🍺 Nocne życie',
  cycling: '🚴 Rower', van: '🏕️ Van spot', tent: '⛺ Camping',
}

const COST_LABEL: Record<string, string> = {
  free: '🆓 Bezpłatne', cheap: '💸 Tanie', moderate: '💰 Średnie', expensive: '💎 Drogie',
}

// 1200 -> "1,2k", 50000 -> "50k"
function formatCount(n: number): string {
  if (n >= 1000) {
    const k = n / 1000
    return `${(n >= 10000 ? Math.round(k) : Math.round(k * 10) / 10).toString().replace('.', ',')}k`
  }
  return String(n)
}

// Szybkie karty Google z placeholderami opisów (przed wzbogaceniem AI).
function buildQuickPlaces(googlePlaces: any[]): AIPlace[] {
  return googlePlaces.map((p: any) => ({
    ...p,
    tags: p.tags || [],
    description: p.description || 'Trwa analiza AI...',
    whyThisGroup: p.whyThisGroup || 'Dopasowanie do profilu grupy: trwa analiza',
    groupFitNote: p.groupFitNote || 'trwa analiza',
    bestTime: p.bestTime || 'brak danych',
    visitTips: p.visitTips || 'brak danych',
    reviewSummary: p.reviewSummary || 'brak danych',
    recentReviewHighlights: p.recentReviewHighlights || [],
  }))
}

// ——— KARTA MIEJSCA ———
function PlaceCard({ place, groupActivities, isSaved, onSave, savedData, onVote, onAddNote, sessionId }: {
  place: AIPlace
  groupActivities: string[]
  isSaved: boolean
  onSave: () => void
  savedData?: SavedPlace
  onVote: () => void
  onAddNote: (text: string) => void
  sessionId: string
}) {
  const [showNotes, setShowNotes] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [showSources, setShowSources] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const matches = (place.tags || []).filter(t => groupActivities.includes(t))
  const isMatch = matches.length > 0

  return (
    <div className={`rounded-2xl border p-4 space-y-3 transition-all ${
      isMatch ? 'bg-forest-900/15 border-forest-700/40' : 'bg-stone-800/40 border-stone-700/40'
    }`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap mb-1">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              place.region === 'budapest'
                ? 'bg-sand-800/40 text-sand-400 border border-sand-700/30'
                : 'bg-forest-800/40 text-forest-400 border border-forest-700/30'
            }`}>
              📍 {place.subregion || place.country || 'Brak lokalizacji'}
            </span>
            {isMatch && (
              <span className="text-xs text-forest-500 bg-forest-800/20 px-2 py-0.5 rounded-full border border-forest-700/20">
                ✓ pasuje do ekipy
              </span>
            )}
            {(place.mentionCount || 0) > 0 && (
              <span className="text-xs font-semibold text-amber-300 bg-amber-500/15 px-2.5 py-0.5 rounded-full border border-amber-500/40 shadow-sm shadow-amber-900/20">
                📚 {place.mentionCount === 1 ? 'Polecane w blogu' : `Polecane w ${place.mentionCount} blogach podróżniczych`}
              </span>
            )}
            {place.verified && (
              <a
                href={place.googlePlaceId
                  ? `https://www.google.com/maps/place/?q=place_id:${place.googlePlaceId}`
                  : `https://www.google.com/maps/search/${encodeURIComponent(place.name)}`
                }
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-emerald-400 bg-emerald-900/20 px-2 py-0.5 rounded-full border border-emerald-700/30 flex items-center gap-1 hover:bg-emerald-900/40 transition-colors"
              >
                ✅ Google
                {place.googleRating != null && (
                  <span className="font-semibold">
                    ⭐ {place.googleRating}
                    {place.googleTotalRatings ? ` (${formatCount(place.googleTotalRatings)})` : ''}
                  </span>
                )}
                {place.isOpen === true && <span className="text-green-300">· Otwarte</span>}
                {place.isOpen === false && <span className="text-red-300">· Zamknięte</span>}
              </a>
            )}
          </div>
          <h3 className="font-display text-base font-semibold text-stone-100">{place.name}</h3>
        </div>
        <button
          onClick={onSave}
          className={`flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
            isSaved
              ? 'bg-forest-700/30 border border-forest-600/40 text-forest-400'
              : 'bg-stone-700 border border-stone-600 text-stone-300 hover:bg-forest-700/20 hover:border-forest-600/40'
          }`}
        >
          <Heart className={`w-3.5 h-3.5 ${isSaved ? 'fill-forest-400' : ''}`} />
          {isSaved ? 'Zapisano' : 'Zapisz'}
        </button>
      </div>

      {/* Description */}
      <p className="text-stone-400 text-xs leading-relaxed">{place.description}</p>

      {/* Why this group */}
      {place.whyThisGroup && (
        <div className="bg-stone-800/60 rounded-xl px-3 py-2 border border-stone-700/30">
          <p className="text-stone-300 text-xs">💡 {place.whyThisGroup}</p>
        </div>
      )}

      {/* Tags + cost */}
      <div className="flex flex-wrap gap-1.5">
        {(place.tags || []).filter(tag => ACTIVITY_TAGS[tag]).map(tag => (
          <span key={tag} className={`text-xs px-2 py-0.5 rounded-full ${
            groupActivities.includes(tag)
              ? 'bg-forest-800/40 text-forest-300 border border-forest-700/30'
              : 'bg-stone-800 text-stone-500 border border-stone-700/30'
          }`}>
            {ACTIVITY_TAGS[tag]}
          </span>
        ))}
        {place.estimatedCost && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-stone-800 text-stone-500 border border-stone-700/30">
            {COST_LABEL[place.estimatedCost] || place.estimatedCost}
          </span>
        )}
      </div>

      {/* Szczegóły — rozwijana sekcja */}
      <button
        onClick={() => setShowDetails(!showDetails)}
        className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-xl border transition-all ${
          showDetails
            ? 'bg-water-900/30 border-water-700/40 text-water-400'
            : 'bg-stone-800/60 border-stone-700/40 text-water-500 hover:border-water-600/40 hover:text-water-400'
        }`}
      >
        <ChevronDown className={`w-3 h-3 transition-transform ${showDetails ? 'rotate-180' : ''}`} />
        {showDetails ? 'Ukryj szczegóły' : '🔍 Szczegóły miejsca'}
      </button>

      {showDetails && (
        <div className="bg-stone-900/60 border border-stone-800/60 rounded-xl p-3 space-y-2 text-xs">
          {place.distanceFromBase != null && (
            <div className="flex items-center justify-between">
              <span className="text-stone-500">📍 Odległość od bazy</span>
              <span className="text-stone-300 font-medium">{place.distanceFromBase} km</span>
            </div>
          )}
          {place.localityScore != null && place.localityScore > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-stone-500">🏡 Lokalność</span>
              <div className="flex items-center gap-1">
                {Array.from({length: 10}).map((_, i) => (
                  <div key={i} className="w-1.5 h-1.5 rounded-full" style={{background: i < (place.localityScore || 0) ? '#4ade80' : '#292524'}} />
                ))}
              </div>
            </div>
          )}
          {place.authenticityNote && (
            <div>
              <span className="text-stone-500">✨ Autentyczność: </span>
              <span className="text-stone-400">{place.authenticityNote}</span>
            </div>
          )}
          {place.groupFitNote && (
            <div>
              <span className="text-stone-500">Dopasowanie ekipy: </span>
              <span className="text-stone-400">{place.groupFitNote}</span>
            </div>
          )}
          {place.bestTime && (
            <div>
              <span className="text-stone-500">Najlepszy czas: </span>
              <span className="text-stone-400">{place.bestTime}</span>
            </div>
          )}
          {place.visitTips && (
            <div>
              <span className="text-stone-500">Wskazówki: </span>
              <span className="text-stone-400">{place.visitTips}</span>
            </div>
          )}
          {place.reviewSummary && (
            <div>
              <span className="text-stone-500">Opinie: </span>
              <span className="text-stone-400">{place.reviewSummary}</span>
            </div>
          )}
          {place.recentReviewHighlights && place.recentReviewHighlights.length > 0 && (
            <div>
              <span className="text-stone-500">Świeże opinie:</span>
              <ul className="mt-1 space-y-1">
                {place.recentReviewHighlights.slice(0, 3).map((line, idx) => (
                  <li key={`${place.name}-review-${idx}`} className="text-stone-400 text-[11px]">
                    • {line}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {place.country && (
            <div className="flex items-center justify-between">
              <span className="text-stone-500">🌍 Kraj</span>
              <span className="text-stone-300">{place.country}</span>
            </div>
          )}
          {place.googleAddress && (
            <div>
              <span className="text-stone-500">📬 Adres: </span>
              <span className="text-stone-400">{place.googleAddress}</span>
            </div>
          )}
          {place.googleTotalRatings != null && place.googleTotalRatings > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-stone-500">⭐ Google</span>
              <span className="text-stone-300">{place.googleRating}/5 ({place.googleTotalRatings} opinii)</span>
            </div>
          )}
        </div>
      )}

      {/* Sources + sentiment + maps */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setShowSources(!showSources)}
          className="flex items-center gap-1.5 text-stone-500 hover:text-stone-300 text-xs transition-colors"
        >
          <Star className="w-3 h-3" />
          {(() => {
            const m = Math.max(place.mentionCount || 0, place.blogSources?.length || 0, place.sourceCount || 0)
            return m > 0 ? `wspomniany ${m} ${m === 1 ? 'raz' : 'razy'}` : (place.sentiment || 'Szczegóły')
          })()}
          <ChevronDown className={`w-3 h-3 transition-transform ${showSources ? 'rotate-180' : ''}`} />
        </button>
        <a
          href={place.googlePlaceId && place.lat && place.lon
            ? `https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lon}&destination_place_id=${place.googlePlaceId}`
            : place.lat && place.lon
              ? `https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lon}`
              : `https://www.google.com/maps/search/${encodeURIComponent(place.name + ' ' + (place.country || 'Slovenia'))}`
          }
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-water-400 hover:text-water-300 text-xs transition-colors"
        >
          <MapPin className="w-3 h-3" /> Nawiguj
        </a>
      </div>

      {/* Blog sources (baza wiedzy / Layer 0) */}
      {showSources && (place.blogSources || []).length > 0 && (
        <div className="space-y-1.5 border-t border-stone-700/40 pt-2">
          <span className="text-xs text-amber-500/80">📚 Wspomniane w:</span>
          {(place.blogSources || []).map((s, i) => (
            <a key={i} href={s.url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 text-xs text-amber-400/90 hover:text-amber-300 transition-colors">
              <ExternalLink className="w-3 h-3 flex-shrink-0" />
              <span className="truncate">{s.title || s.url}</span>
            </a>
          ))}
        </div>
      )}

      {/* Saved place actions */}
      {savedData && (
        <div className="border-t border-stone-700/40 pt-3 space-y-2">
          <div className="flex items-center gap-2">
            <button onClick={onVote}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs transition-all ${
                (savedData.voters as string[]).includes(sessionId)
                  ? 'bg-water-700/20 border border-water-600/40 text-water-300'
                  : 'bg-stone-800 border border-stone-700 text-stone-500 hover:text-stone-300'
              }`}>
              👍 {savedData.votes}
            </button>
            <button onClick={() => setShowNotes(!showNotes)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs bg-stone-800 border border-stone-700 text-stone-500 hover:text-stone-300 transition-all">
              <MessageSquare className="w-3 h-3" />
              {(savedData.notes as any[]).length > 0 ? `${(savedData.notes as any[]).length} notatki` : 'Notatka'}
            </button>
          </div>
          {(savedData.notes as any[]).length > 0 && showNotes && (
            <div className="space-y-1">
              {(savedData.notes as any[]).map((note: any, i: number) => (
                <div key={i} className="bg-stone-800/60 rounded-lg px-3 py-2">
                  <p className="text-stone-500 text-xs">{note.user_name}: <span className="text-stone-300">{note.text}</span></p>
                </div>
              ))}
            </div>
          )}
          {showNotes && (
            <div className="flex gap-2">
              <input type="text" value={noteText} onChange={e => setNoteText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && noteText.trim() && (onAddNote(noteText), setNoteText(''))}
                placeholder="Twoja notatka..."
                className="flex-1 bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-xs text-stone-100 placeholder-stone-600 focus:outline-none focus:border-forest-500" />
              <button onClick={() => { if (noteText.trim()) { onAddNote(noteText); setNoteText('') } }}
                className="bg-forest-600 hover:bg-forest-500 text-white px-3 py-2 rounded-lg text-xs">Dodaj</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ——— GŁÓWNY KOMPONENT ———
export default function PlacesTab({ room, myPrefs, allPrefs, prefetched }: Props) {
  const [aiPlaces, setAiPlaces] = useState<AIPlace[]>([])
  const [baseLat, setBaseLat] = useState<number | null>(null)
  const [baseLon, setBaseLon] = useState<number | null>(null)
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([])
  const [loading, setLoading] = useState(false)
  const [searchCount, setSearchCount] = useState(0)
  const [fadingOut, setFadingOut] = useState(false)
  const [resultsVisible, setResultsVisible] = useState(false)
  const [activeRegion, setActiveRegion] = useState<'all' | 'budapest' | 'slovenia'>('all')
  const [showAll, setShowAll] = useState(true)
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [searchMode, setSearchMode] = useState<SearchMode>('standard')
  const [radiusKm, setRadiusKm] = useState(40)
  const [sortBy, setSortBy] = useState<'match' | 'rating' | 'distance'>('match')
  const [loadingMore, setLoadingMore] = useState(false)
  const [enriching, setEnriching] = useState(false)
  const [enrichDone, setEnrichDone] = useState(0)
  const [enrichTotal, setEnrichTotal] = useState(0)
  const [error, setError] = useState('')
  const [debugLine, setDebugLine] = useState('')
  const sessionId = getSessionId()

  const groupActivities = (() => {
    const completed = allPrefs.filter(p => p.completed)
    if (completed.length === 0) return myPrefs.activities || []
    const counts: Record<string, number> = {}
    completed.forEach(p => (p.activities || []).forEach(a => { counts[a] = (counts[a] || 0) + 1 }))
    return Object.entries(counts).filter(([, c]) => c >= 1).map(([id]) => id)
  })()

  useEffect(() => {
    loadSavedPlaces()
    // Tor B: jeśli onboarding dostarczył prefetch miejsc — uruchom od razu
    // wzbogacanie AI (bez czekania na klik). Inaczej wczytaj zapisane rekomendacje.
    if (prefetched && (prefetched.places?.length ?? 0) > 0) {
      handleSearch({
        preGooglePlaces: prefetched.places,
        preBaseLat: prefetched.baseLat,
        preBaseLon: prefetched.baseLon,
        silent: true,
      })
    } else {
      loadSavedRecommendations()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.id])

  async function loadSavedRecommendations() {
    const { data } = await supabase
      .from('ai_recommendations')
      .select('*')
      .eq('room_id', room.id)
      .order('created_at', { ascending: false })
      .limit(1)
    if (data && data.length > 0 && (data[0].places || []).length > 0) {
      setAiPlaces(data[0].places || [])
      setResultsVisible(true)
    }
  }

  async function saveRecommendations(places: AIPlace[]) {
    // Usuń stare i zapisz nowe
    await supabase.from('ai_recommendations').delete().eq('room_id', room.id)
    await supabase.from('ai_recommendations').insert({
      room_id: room.id,
      region: countryToRegion(room.country || 'Slovenia'),
      places,
      posts_analyzed: 0,
    })
  }

  async function loadSavedPlaces() {
    const { data } = await supabase.from('saved_places').select('*').eq('room_id', room.id)
    setSavedPlaces(data || [])
  }

  async function handleSearchMore() {
    setLoadingMore(true)
    // Dociąga kolejną pulę miejsc z silnika /api/discover (większy promień)
    // i wzbogaca je AI, dodając nowe do już pokazanych.
    const region = countryToRegion(room.country || 'Slovenia')
    const tripDaysMore = room.start_date && room.end_date
      ? Math.ceil((new Date(room.end_date).getTime() - new Date(room.start_date).getTime()) / 86400000)
      : null

    try {
      // Poszerz promień do maksimum, by znaleźć miejsca poza dotychczasową pulą.
      const widerRadius = 80
      const discoverRes = await fetch('/api/discover', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseCity: room.end_city || '', country: room.country || '',
          activities: groupActivities, radius: widerRadius, sort: sortBy,
          intensity: myPrefs.intensity, numPeople: room.num_people || 4,
        }),
      })
      if (!discoverRes.ok) { setLoadingMore(false); return }
      const gData = await discoverRes.json()
      const fresh = (gData.places || [])
        .filter((np: any) => np && np.name && !aiPlaces.find(ep => ep.name === np.name))
        .slice(0, 12)
        .map((p: any) => {
          const { sources, ...rest } = p
          return { ...rest, blogSources: Array.isArray(sources) ? sources : undefined }
        })
      if (fresh.length === 0) { setLoadingMore(false); return }

      const res = await fetch('/api/places', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          googlePlaces: fresh,
          activities: groupActivities, region, searchMode,
          baseCity: room.end_city || '', transport: myPrefs.transport,
          accommodation: myPrefs.accommodation, intensity: myPrefs.intensity,
          numPeople: room.num_people || 4, startDate: room.start_date,
          endDate: room.end_date, tripDays: tripDaysMore, batch: 1,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        const enriched = (data.places || []).map((p: AIPlace) => ({ ...p, tags: p.tags || [] }))
        // Scal opisy AI na świeżą pulę (fallback: surowe dane z discover)
        const byName = new Map(enriched.map((e: AIPlace) => [e.name, e]))
        const newPlaces = fresh.map((f: AIPlace) => {
          const e = byName.get(f.name)
          return e ? { ...f, ...(e as AIPlace), tags: (e as AIPlace).tags || f.tags || [] } : f
        })
        const updated = [...aiPlaces, ...newPlaces]
        for (const place of newPlaces) {
          await new Promise(r => setTimeout(r, 150))
          setAiPlaces(prev => [...prev, place])
        }
        await saveRecommendations(updated)
      }
    } catch {}
    setLoadingMore(false)
  }

  async function handleSearch(opts?: { preGooglePlaces?: any[]; preBaseLat?: number | null; preBaseLon?: number | null; silent?: boolean }) {
    const isPrefetch = !!opts?.preGooglePlaces
    if (!opts?.silent) setLoading(true)
    setEnriching(false)
    setError('')
    setDebugLine('')
    setAiPlaces([])
    setResultsVisible(false)
    setSearchCount(c => c + 1)

    const region = countryToRegion(room.country || 'Slovenia')
    // Zawsze pobieramy pełną pulę na maks. promień (80 km) i cache'ujemy ją.
    // Suwak nie wywołuje już ponownego fetcha — filtruje pokazaną listę po
    // stronie klienta w czasie rzeczywistym (p.distanceFromBase <= radiusKm).
    const radius = 80
    const tripDaysCalc = room.start_date && room.end_date
      ? Math.ceil((new Date(room.end_date).getTime() - new Date(room.start_date).getTime()) / 86400000)
      : null

    // Krok 1: silnik /api/discover (baza wiedzy z blogów → kuracja DeepSeek →
    // weryfikacja Google → ranking) dostarcza pulę miejsc do wzbogacenia.
    let googlePlaces: any[] = []

    // Mapuje pulę z silnika: pole `sources` ({url,title}) to źródła blogowe —
    // przenosimy je do `blogSources`, by karta pokazała "Wspomniane w:".
    const mapDiscover = (arr: any[]) => arr.slice(0, 60).map((p: any) => {
      const { sources, ...rest } = p
      return { ...rest, blogSources: Array.isArray(sources) ? sources : undefined }
    })

    if (isPrefetch) {
      // Tor B: miejsca z /api/discover są już w pamięci (pobrane podczas animacji).
      // Pomijamy ponowny fetch — mapujemy gotową pulę i pokazujemy ją natychmiast.
      googlePlaces = mapDiscover(opts!.preGooglePlaces || [])
      const preLat = opts!.preBaseLat ?? null
      const preLon = opts!.preBaseLon ?? null
      if (preLat) setBaseLat(preLat)
      if (preLon) setBaseLon(preLon)
      if (googlePlaces.length > 0) {
        setAiPlaces(buildQuickPlaces(googlePlaces))
        setResultsVisible(true)
        setLoading(false)
      }
    } else {
      try {
        const discoverRes = await fetch('/api/discover', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            baseCity: room.end_city || '', country: room.country || '',
            activities: groupActivities, radius, sort: sortBy,
            intensity: myPrefs.intensity, numPeople: room.num_people || 4,
          }),
        })
        if (discoverRes.ok) {
          const gData = await discoverRes.json()
          // Cap pilnuje backend (/api/places, MAX_ENRICH_PLACES). Tu bierzemy całą,
          // już posortowaną pulę z silnika — liczba miejsc zależy od ilości znalezionych.
          googlePlaces = mapDiscover(gData.places || [])
          if (gData.baseLat) setBaseLat(gData.baseLat)
          if (gData.baseLon) setBaseLon(gData.baseLon)
        }
      } catch {}
    }

    const hasEarlyGoogleResults = googlePlaces.length > 0

    if (hasEarlyGoogleResults) {
      setAiPlaces(buildQuickPlaces(googlePlaces))
      setResultsVisible(true)
      setLoading(false)
    }
    setEnriching(true)

    // Krok 2: progressive enrichment — dzielimy pulę na paczki i scalamy wyniki
    // w miarę napływania, żeby opisy AI pojawiały się stopniowo (a nie naraz).
    const keyOf = (p: any) => (p?.googlePlaceId || p?.name || '').toString().toLowerCase().trim()
    try {
      if (googlePlaces.length > 0) {
        // Lokalna kopia puli z placeholderami — podmieniamy karty po kluczu.
        const working: AIPlace[] = buildQuickPlaces(googlePlaces)
        const idxByKey = new Map<string, number>()
        working.forEach((p, i) => idxByKey.set(keyOf(p), i))

        const CLIENT_CHUNK = 6
        const ENRICH_CONCURRENCY = 3
        const chunks: any[][] = []
        for (let i = 0; i < googlePlaces.length; i += CLIENT_CHUNK) {
          chunks.push(googlePlaces.slice(i, i + CLIENT_CHUNK))
        }

        setEnrichDone(0)
        setEnrichTotal(googlePlaces.length)
        let anyParsed = false
        let anyFallback = false
        let lastStatus = 0

        const runChunk = async (chunk: any[]) => {
          try {
            const res = await fetch('/api/places', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                googlePlaces: chunk,
                activities: groupActivities, region, searchMode,
                baseCity: room.end_city || '', transport: myPrefs.transport,
                accommodation: myPrefs.accommodation, intensity: myPrefs.intensity,
                numPeople: room.num_people || 4, startDate: room.start_date,
                endDate: room.end_date, tripDays: tripDaysCalc, batch: 1,
              }),
            })
            lastStatus = res.status
            let enriched: AIPlace[] = []
            if (res.ok) {
              const data = await res.json()
              enriched = (data.places || []).map((p: AIPlace) => ({ ...p, tags: p.tags || [] }))
              if (data.meta?.parseOk) anyParsed = true
              if (data.meta?.usedFallback) anyFallback = true
            }
            if (enriched.length === 0) {
              // sieć/serwer padł dla tej paczki — zostaw surowe dane Google
              for (const raw of chunk) {
                const i = idxByKey.get(keyOf(raw))
                if (i !== undefined && working[i].description === 'Trwa analiza AI...') {
                  working[i] = { ...working[i], description: 'Google zwrocil miejsce, ale AI nie wygenerowalo opisu.' }
                }
              }
            } else {
              for (const e of enriched) {
                const i = idxByKey.get(keyOf(e))
                if (i !== undefined) working[i] = { ...working[i], ...e, tags: e.tags || working[i].tags || [] }
              }
            }
          } catch {
            // zostaw placeholdery dla tej paczki
          } finally {
            setEnrichDone((d) => Math.min(d + chunk.length, googlePlaces.length))
            setAiPlaces(working.slice())
          }
        }

        // Bounded concurrency.
        let cursor = 0
        await Promise.all(
          Array.from({ length: Math.min(ENRICH_CONCURRENCY, chunks.length) }, async () => {
            while (cursor < chunks.length) {
              const my = cursor++
              await runChunk(chunks[my])
            }
          }),
        )

        setAiPlaces(working.slice())
        setDebugLine(
          `Debug: google=${googlePlaces.length}, paczki=${chunks.length}, fallback=${anyFallback ? 'tak' : 'nie'}, parse=${anyParsed ? 'ok' : 'fail'}, status=${lastStatus}`,
        )
        if (anyFallback) setError('Czesc opisow AI sie nie wygenerowala — dla tych miejsc pokazuje dane podstawowe z Google.')
        await saveRecommendations(working)
      } else {
        // Brak miejsc z silnika — pokaż pustą listę z komunikatem.
        setFadingOut(true)
        await new Promise(r => setTimeout(r, 400))
        setAiPlaces([])
        setError('Nie znaleziono miejsc dla tych preferencji. Spróbuj zwiększyć promień lub zmienić aktywności.')
      }

      setLoading(false)
      setEnriching(false)
      setFadingOut(false)
      await new Promise(r => setTimeout(r, 50))
      setResultsVisible(true)
    } catch (e) {
      setError('Nie udalo sie pobrac rekomendacji. Sprawdz polaczenie.')
      setDebugLine('Debug: /api/places request failed (network/server).')
      setEnriching(false)
      setLoading(false)
    }
  }


  async function savePlace(place: AIPlace) {
    if (savedPlaces.find(s => s.place_name === place.name)) return
    // FIX2: upsert z unikalnym indeksem (room_id, place_name) — chroni przed duplikatami
    // przy jednoczesnym zapisie tego samego miejsca przez kilka osob.
    const { data } = await supabase.from('saved_places').upsert({
      room_id: room.id,
      place_name: place.name,
      place_data: { description: place.description, activities: place.tags, sources: place.sourceCount, sentiment: place.sentiment, region: place.region, subregion: place.subregion },
      votes: 1, voters: [sessionId], notes: [], tags: place.tags,
    }, { onConflict: 'room_id,place_name', ignoreDuplicates: true }).select().single()
    if (data) setSavedPlaces(prev => prev.find(p => p.id === data.id) ? prev : [...prev, data])
  }

  async function votePlace(placeId: string, _voters: string[], _votes: number) {
    // FIX1: atomowe przelaczenie glosu po stronie bazy (RPC toggle_vote) —
    // eliminuje gubione glosy przy jednoczesnym glosowaniu (read-modify-write race).
    const { data } = await supabase.rpc('toggle_vote', { p_id: placeId, p_session: sessionId })
    if (data) setSavedPlaces(prev => prev.map(p => p.id === placeId ? (data as any) : p))
  }

  async function addNote(placeId: string, text: string) {
    const place = savedPlaces.find(p => p.id === placeId)
    if (!place) return
    const newNote = { session_id: sessionId, user_name: getSessionName(), text, created_at: new Date().toISOString() }
    const { data } = await supabase.from('saved_places').update({ notes: [...(place.notes as any[] || []), newNote] }).eq('id', placeId).select().single()
    if (data) setSavedPlaces(prev => prev.map(p => p.id === placeId ? data : p))
  }

  const filteredPlaces = aiPlaces.filter(p => {
    const regionOk = activeRegion === 'all' || p.region === activeRegion
    const tagOk = activeTag === null || p.tags.includes(activeTag)
    // Filtr suwaka w czasie rzeczywistym — pula jest pobrana na 80 km, a tu
    // przycinamy ją do wybranego promienia. Miejsca bez znanej odległości
    // zostawiamy widoczne (nie ukrywamy ich przez brak danych).
    const distanceOk = p.distanceFromBase == null || p.distanceFromBase <= radiusKm
    return regionOk && tagOk && distanceOk
  }).slice().sort((a, b) => {
    if (sortBy === 'rating') {
      return (b.googleRating ?? 0) - (a.googleRating ?? 0) ||
        (b.googleTotalRatings ?? 0) - (a.googleTotalRatings ?? 0)
    }
    if (sortBy === 'distance') {
      return (a.distanceFromBase ?? Infinity) - (b.distanceFromBase ?? Infinity)
    }
    // 'match' — wg wyniku silnika (score), z fallbackiem na odległość
    return (b.score ?? 0) - (a.score ?? 0) ||
      (a.distanceFromBase ?? Infinity) - (b.distanceFromBase ?? Infinity)
  })
  // Defensywny dedup po stabilnym kluczu (place_id lub nazwa) — chroni przed
  // duplikatami z różnych źródeł/etapów (np. rzeka z wieloma place_id, quick+enriched).
  const placeKey = (p: AIPlace) => (p.googlePlaceId || p.name || '').toString().toLowerCase().trim()
  const dedupedPlaces = (() => {
    const seen = new Set<string>()
    const out: AIPlace[] = []
    for (const p of filteredPlaces) {
      const k = placeKey(p)
      if (k && seen.has(k)) continue
      if (k) seen.add(k)
      out.push(p)
    }
    return out
  })()
  const matchingPlaces = dedupedPlaces.filter(p => (p.tags || []).some(t => groupActivities.includes(t)))
  const otherPlaces = dedupedPlaces.filter(p => !(p.tags || []).some(t => groupActivities.includes(t)))

  return (
    <div className="px-4 py-5 max-w-lg mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold text-stone-100">Rekomendacje miejsc</h2>
        {aiPlaces.length > 0 && (
          <span className="text-xs text-stone-500 bg-stone-800 px-2.5 py-1 rounded-full">
            {dedupedPlaces.length} miejsc
          </span>
        )}
      </div>

      {/* Preferencje ekipy */}
      {groupActivities.length > 0 && (
        <div className="bg-forest-900/15 border border-forest-700/30 rounded-xl p-3">
          <p className="text-forest-400 text-xs mb-2">🎯 Szukam dla ekipy:</p>
          <div className="flex flex-wrap gap-1.5">
            {groupActivities.map(a => (
              <span key={a} className="bg-forest-800/40 text-forest-300 text-xs px-2 py-0.5 rounded-full border border-forest-700/30">
                {ACTIVITY_TAGS[a] || a}
              </span>
            ))}
          </div>
        </div>
      )}



      {/* Tryb wyszukiwania */}
      {!loading && (
        <div className="bg-stone-900/40 border border-stone-700/40 rounded-xl p-2">
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setSearchMode('standard')}
              className={`px-3 py-2 rounded-lg text-xs font-medium border transition-all ${
                searchMode === 'standard'
                  ? 'bg-water-900/30 border-water-600/40 text-water-300'
                  : 'bg-stone-800/40 border-stone-700/40 text-stone-400'
              }`}
            >
              Standard (Google-first)
            </button>
            <button
              onClick={() => setSearchMode('research')}
              className={`px-3 py-2 rounded-lg text-xs font-medium border transition-all ${
                searchMode === 'research'
                  ? 'bg-amber-900/30 border-amber-600/40 text-amber-300'
                  : 'bg-stone-800/40 border-stone-700/40 text-stone-400'
              }`}
            >
              Research (lokalne)
            </button>
          </div>
          <p className="text-[11px] text-stone-500 mt-2 px-1">
            {searchMode === 'standard'
              ? 'Tryb standard: sprawdzone i popularne miejsca + AI podsumowanie dla całej ekipy.'
              : 'Tryb research: mocniejszy nacisk na mniej oczywiste, lokalne miejsca i naturę.'}
          </p>
        </div>
      )}

      {/* Promień + sortowanie */}
      {!loading && (
        <div className="bg-stone-900/40 border border-stone-700/40 rounded-xl p-3 space-y-3">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-stone-400 font-medium">📍 Promień wyszukiwania</label>
              <span className="text-xs text-water-300 font-semibold">{radiusKm} km</span>
            </div>
            <input
              type="range" min={30} max={80} step={5}
              value={radiusKm}
              onChange={e => setRadiusKm(Number(e.target.value))}
              className="w-full accent-water-500 cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-stone-600 mt-0.5">
              <span>30 km</span><span>80 km</span>
            </div>
          </div>
          <div>
            <label className="text-xs text-stone-400 font-medium block mb-1.5">↕️ Sortuj wyniki</label>
            <div className="grid grid-cols-3 gap-1.5">
              {([
                ['match', 'Najlepsze dopasowanie'],
                ['rating', 'Ocena'],
                ['distance', 'Odległość'],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setSortBy(key)}
                  className={`px-2 py-2 rounded-lg text-[11px] font-medium border transition-all ${
                    sortBy === key
                      ? 'bg-forest-900/40 border-forest-600/40 text-forest-300'
                      : 'bg-stone-800/40 border-stone-700/40 text-stone-400'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Przyciski */}
      {!loading && (
        <div className="flex gap-2">
          <button onClick={() => handleSearch()} disabled={enriching || loadingMore}
            className="flex-1 flex items-center justify-center gap-2 bg-gradient-to-r from-forest-700 to-water-700 hover:from-forest-600 hover:to-water-600 disabled:opacity-60 text-white rounded-2xl py-4 font-semibold text-sm transition-all active:scale-95 shadow-lg">
            <RefreshCw className="w-4 h-4" />
            {enriching ? 'AI dopracowuje...' : aiPlaces.length > 0 ? 'Odśwież' : 'Szukaj dla ekipy'}
          </button>
          {aiPlaces.length > 0 && (
            <button onClick={handleSearchMore} disabled={loadingMore || enriching}
              className="flex items-center justify-center gap-2 bg-stone-800 hover:bg-stone-700 disabled:opacity-60 border border-stone-700 text-stone-300 rounded-2xl px-4 font-semibold text-sm transition-all active:scale-95">
              {loadingMore ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Szukam...</>
              ) : '+ Więcej'}
            </button>
          )}
        </div>
      )}

      {/* Animacja skanowania */}
      <div style={{
        opacity: loading ? (fadingOut ? 0 : 1) : 0,
        transition: 'opacity .5s ease',
        display: loading ? 'block' : 'none',
      }}>
        <GlobeAnimation key={searchCount} />
      </div>

      {/* Błąd */}
      {error && <p className="text-red-400 text-xs bg-red-400/10 rounded-xl px-4 py-3">{error}</p>}
      {debugLine && (
        <p className="text-stone-400 text-[11px] bg-stone-900/40 border border-stone-700/40 rounded-xl px-4 py-2">
          {debugLine}
        </p>
      )}
      {!loading && enriching && (
        <p className="text-water-300 text-xs bg-water-900/20 border border-water-800/30 rounded-xl px-4 py-3">
          Miejsca z Google są już widoczne. AI dogrywa opisy stopniowo
          {enrichTotal > 0 ? ` — wzbogacono ${Math.min(enrichDone, enrichTotal)}/${enrichTotal}` : ''}.
        </p>
      )}

      {/* Filtry kategorii */}
      {!loading && aiPlaces.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setActiveTag(null)}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
              activeTag === null ? 'bg-stone-700 text-stone-100 border border-stone-600' : 'bg-stone-800/40 text-stone-500 border border-stone-700/40'
            }`}
          >
            🗺️ Wszystkie
          </button>
          {groupActivities.map(tag => (
            <button
              key={tag}
              onClick={() => setActiveTag(activeTag === tag ? null : tag)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
                activeTag === tag ? 'bg-forest-700/40 text-forest-300 border border-forest-600/40' : 'bg-stone-800/40 text-stone-500 border border-stone-700/40'
              }`}
            >
              {ACTIVITY_TAGS[tag] || tag}
            </button>
          ))}
        </div>
      )}

      {/* Wyniki Google */}
      {!loading && aiPlaces.length > 0 && (
        <div className="space-y-4" style={{
          opacity: resultsVisible ? 1 : 0,
          transform: resultsVisible ? 'translateY(0)' : 'translateY(12px)',
          transition: 'opacity .5s ease, transform .5s ease',
        }}>
          {/* Pasujące do ekipy */}
          {matchingPlaces.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs text-forest-400 font-semibold uppercase tracking-wider">
                ✨ Dopasowane do ekipy ({matchingPlaces.length})
              </p>
              {matchingPlaces.map(place => (
                <PlaceCard
                  key={placeKey(place)}
                  place={place}
                  groupActivities={groupActivities}
                  isSaved={savedPlaces.some(s => s.place_name === place.name)}
                  onSave={() => savePlace(place)}
                  savedData={savedPlaces.find(s => s.place_name === place.name)}
                  onVote={() => { const sp = savedPlaces.find(s => s.place_name === place.name); if (sp) votePlace(sp.id, sp.voters as string[], sp.votes) }}
                  onAddNote={text => { const sp = savedPlaces.find(s => s.place_name === place.name); if (sp) addNote(sp.id, text) }}
                  sessionId={sessionId}
                />
              ))}
            </div>
          )}

          {/* Inne */}
          {otherPlaces.length > 0 && (
            <div>
              <button onClick={() => setShowAll(!showAll)}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-stone-800/40 border border-stone-700/40 text-stone-500 text-xs transition-all">
                <Filter className="w-3.5 h-3.5" />
                {showAll ? 'Ukryj' : `Pokaż więcej (${otherPlaces.length})`}
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showAll ? 'rotate-180' : ''}`} />
              </button>
              {showAll && (
                <div className="space-y-3 mt-3">
                  {otherPlaces.map(place => (
                    <PlaceCard key={placeKey(place)} place={place} groupActivities={groupActivities}
                      isSaved={savedPlaces.some(s => s.place_name === place.name)}
                      onSave={() => savePlace(place)}
                      savedData={savedPlaces.find(s => s.place_name === place.name)}
                      onVote={() => { const sp = savedPlaces.find(s => s.place_name === place.name); if (sp) votePlace(sp.id, sp.voters as string[], sp.votes) }}
                      onAddNote={text => { const sp = savedPlaces.find(s => s.place_name === place.name); if (sp) addNote(sp.id, text) }}
                      sessionId={sessionId}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Zapisane */}
      {savedPlaces.length > 0 && (
        <div>
          <p className="text-xs text-stone-500 font-semibold uppercase tracking-wider mb-3">
            ❤️ Zapisane przez ekipę ({savedPlaces.length})
          </p>
          <div className="space-y-2">
            {savedPlaces.sort((a, b) => b.votes - a.votes).map(sp => (
              <div key={sp.id} className="flex items-center gap-3 bg-stone-800/40 border border-stone-700/30 rounded-xl px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-stone-200 text-sm font-medium truncate">{sp.place_name}</p>
                  <p className="text-stone-600 text-xs">{(sp.tags as string[]).map(t => ACTIVITY_TAGS[t] || t).join(' · ')}</p>
                </div>
                <button onClick={() => votePlace(sp.id, sp.voters as string[], sp.votes)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs transition-all ${
                    (sp.voters as string[]).includes(sessionId) ? 'bg-water-700/20 text-water-300' : 'bg-stone-700 text-stone-400'
                  }`}>
                  👍 {sp.votes}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-stone-800/20 border border-dashed border-stone-700/40 rounded-xl p-4 text-center">
        <p className="text-stone-600 text-xs">🔜 Więcej źródeł wkrótce — TikTok, Google Reviews</p>
      </div>
    </div>
  )
}
