'use client'


const ACTIVITY_QUERIES: Record<string, string[]> = {
  sup: ['Slovenia SUP paddleboard lake', 'Bled Bohinj kayak paddle', 'Soča river kayak'],
  trekking: ['Slovenia hiking trail', 'Julian Alps trekking', 'Slovenia waterfall hike'],
  food: ['Slovenia local restaurant', 'Ljubljana food must try', 'Slovenia traditional cuisine'],
  sunset: ['Slovenia viewpoint sunset', 'Bled viewpoint photography'],
  sightseeing: ['Slovenia hidden gem tourist', 'Ljubljana worth visiting'],
  nightlife: ['Ljubljana nightlife bar', 'Ljubljana craft beer'],
  markets: ['Ljubljana market local', 'Slovenia farmers market'],
  photo: ['Slovenia photography spot', 'Bled photography best'],
  relax: ['Slovenia thermal spa', 'Slovenia peaceful lake swim'],
  cycling: ['Slovenia cycling route', 'Ljubljana bike path'],
}

const BUDAPEST_QUERIES: Record<string, string[]> = {
  food: ['Budapest local food restaurant', 'Budapest must eat'],
  sightseeing: ['Budapest hidden gem', 'Budapest underrated'],
  nightlife: ['Budapest ruin bar', 'Budapest nightlife'],
  relax: ['Budapest thermal bath', 'Budapest spa'],
  markets: ['Budapest market local', 'Budapest great market'],
  sup: ['Budapest Danube kayak'],
  photo: ['Budapest photography spot'],
  sunset: ['Budapest sunset viewpoint'],
}

async function fetchRedditFromBrowser(activities: string[], region: string): Promise<any[]> {
  const queryMap = region === 'budapest' ? BUDAPEST_QUERIES : ACTIVITY_QUERIES
  const queries: string[] = []
  
  for (const act of activities) {
    const q = queryMap[act] || []
    queries.push(...q.slice(0, 1))
  }
  queries.push(region === 'budapest' ? 'Budapest travel tips' : 'Slovenia travel tips')

  const allPosts: any[] = []
  const seenUrls = new Set<string>()

  for (const query of queries.slice(0, 6)) {
    try {
      const res = await fetch(
        `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=top&limit=8&t=year`,
        { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TripPlanner/1.0)' } }
      )
      if (!res.ok) continue
      const data = await res.json()
      const posts = (data.data?.children || [])
        .filter((c: any) => c.data.score >= 5)
        .map((c: any) => ({
          title: c.data.title,
          score: c.data.score,
          url: `https://reddit.com${c.data.permalink}`,
          subreddit: c.data.subreddit,
          text: (c.data.selftext || '').slice(0, 400),
        }))
      
      for (const p of posts) {
        if (!seenUrls.has(p.url)) {
          seenUrls.add(p.url)
          allPosts.push(p)
        }
      }
    } catch {
      // Jeśli Reddit blokuje - kontynuuj bez niego
    }
  }

  return allPosts.slice(0, 25)
}

import { useState, useEffect } from 'react'
import GlobeAnimation from './GlobeAnimation'
import { supabase, SavedPlace, Room, UserPreference } from '@/lib/supabase'
import { getSessionId, getSessionName } from '@/lib/session'
import { Heart, MessageSquare, Star, MapPin, ExternalLink, ChevronDown, Filter, RefreshCw } from 'lucide-react'

interface Props {
  room: Room
  myPrefs: UserPreference
  allPrefs: UserPreference[]
}

interface AIPlace {
  name: string
  description: string
  whyThisGroup: string
  tags: string[]
  region: 'budapest' | 'slovenia'
  subregion: string
  lat?: number
  lon?: number
  estimatedCost: 'free' | 'cheap' | 'moderate' | 'expensive'
  sourceCount: number
  sentiment: string
  sources: { title: string; url: string; score: number; subreddit: string }[]
}

const ACTIVITY_TAGS: Record<string, string> = {
  sup: '🏄 SUP', trekking: '🥾 Trekking', food: '🍽️ Jedzenie',
  sunset: '🌅 Widok', sightseeing: '🏛️ Zwiedzanie', relax: '🧘 Relaks',
  photo: '📸 Foto', markets: '🛒 Targi', nightlife: '🍺 Nocne życie',
  cycling: '🚴 Rower', van: '🏕️ Van spot', tent: '⛺ Camping',
}

const COST_LABEL: Record<string, string> = {
  free: '🆓 Bezpłatne', cheap: '💸 Tanie', moderate: '💰 Średnie', expensive: '💎 Drogie',
}

const Slovenia_SPOTS = ['Bled', 'Bohinj', 'Soča', 'Ljubljana', 'Piran', 'Triglav', 'Kranjska Gora', 'Kobarid', 'Koper', 'Portorož']
const BUDAPEST_SPOTS = ['Budapeszt', 'Buda', 'Pest', 'Óbuda']

// ——— ANIMACJA SKANOWANIA ———
function ScanAnimation({ postsScanned, phase }: { postsScanned: number; phase: number }) {
  const [visibleSpots, setVisibleSpots] = useState<{ name: string; x: number; y: number; alpha: number }[]>([])

  // Punkty na "mapie" Słowenii
  const mapPoints = [
    { name: 'Bled', x: 0.28, y: 0.22 },
    { name: 'Bohinj', x: 0.22, y: 0.28 },
    { name: 'Soča', x: 0.18, y: 0.38 },
    { name: 'Ljubljana', x: 0.42, y: 0.42 },
    { name: 'Triglav', x: 0.25, y: 0.18 },
    { name: 'Piran', x: 0.28, y: 0.72 },
    { name: 'Kobarid', x: 0.15, y: 0.32 },
    { name: 'Kranjska Gora', x: 0.22, y: 0.12 },
    { name: 'Maribor', x: 0.72, y: 0.18 },
    { name: 'Koper', x: 0.25, y: 0.78 },
    { name: 'Budapeszt', x: 0.82, y: 0.28 },
    { name: 'Portorož', x: 0.22, y: 0.82 },
  ]

  useEffect(() => {
    const interval = setInterval(() => {
      const spot = mapPoints[Math.floor(Math.random() * mapPoints.length)]
      setVisibleSpots(prev => {
        const existing = prev.find(s => s.name === spot.name)
        if (existing) return prev
        return [...prev.slice(-6), { ...spot, alpha: 1 }]
      })
    }, 600)
    return () => clearInterval(interval)
  }, [])

  const phases = [
    { icon: '🛰️', text: 'Skanowanie Reddit...', color: '#3d7f41' },
    { icon: '📡', text: `Odebrano ${postsScanned} postów`, color: '#0085cc' },
    { icon: '🧠', text: 'AI analizuje dane...', color: '#8b5cf6' },
    { icon: '📍', text: 'Mapowanie rekomendacji...', color: '#e09f4d' },
  ]

  const currentPhase = phases[Math.min(phase, phases.length - 1)]

  return (
    <div className="flex flex-col items-center justify-center py-8 px-4">
      {/* Mapa Słowenii - SVG */}
      <div className="relative w-full max-w-sm h-48 mb-6">
        <svg viewBox="0 0 400 220" className="w-full h-full opacity-20">
          {/* Uproszczony zarys Słowenii */}
          <path d="M60,80 L80,60 L120,50 L160,45 L200,48 L240,55 L280,60 L320,70 L340,80 L330,100 L310,115 L280,120 L260,130 L240,145 L220,160 L200,170 L180,165 L160,155 L140,150 L120,160 L100,155 L80,140 L65,120 L60,100 Z" fill="#3d7f41" stroke="#3d7f41" strokeWidth="2"/>
          {/* Węgry */}
          <path d="M300,50 L380,55 L390,80 L385,110 L370,120 L340,115 L320,100 L310,80 Z" fill="#0085cc" opacity="0.5" stroke="#0085cc" strokeWidth="1"/>
        </svg>

        {/* Pinezki pojawiające się na mapie */}
        {visibleSpots.map((spot, i) => (
          <div
            key={spot.name}
            className="absolute flex flex-col items-center animate-fade-up"
            style={{
              left: `${spot.x * 100}%`,
              top: `${spot.y * 100}%`,
              transform: 'translate(-50%, -100%)',
            }}
          >
            <div className="bg-forest-500 text-white text-xs px-1.5 py-0.5 rounded-full whitespace-nowrap font-medium shadow-lg">
              {spot.name}
            </div>
            <div className="w-1.5 h-1.5 bg-forest-400 rounded-full mt-0.5 animate-pulse" />
          </div>
        ))}

        {/* Latający skaner */}
        <div
          className="absolute w-full h-0.5 bg-gradient-to-r from-transparent via-forest-400 to-transparent opacity-60"
          style={{
            top: `${((Date.now() / 1000) % 1) * 100}%`,
            animation: 'scanLine 2s linear infinite',
          }}
        />
      </div>

      {/* Status */}
      <div className="flex items-center gap-3 bg-stone-800/60 border border-stone-700/40 rounded-2xl px-5 py-3 mb-4">
        <span className="text-2xl animate-pulse-soft">{currentPhase.icon}</span>
        <div>
          <p className="text-stone-200 text-sm font-medium">{currentPhase.text}</p>
          <div className="flex gap-1 mt-1.5">
            {phases.map((p, i) => (
              <div
                key={i}
                className="h-1 rounded-full transition-all duration-500"
                style={{
                  width: i <= phase ? '24px' : '8px',
                  background: i <= phase ? currentPhase.color : '#44403c',
                }}
              />
            ))}
          </div>
        </div>
      </div>

      <p className="text-stone-600 text-xs text-center">
        Przeszukuję Reddit, analizuję rekomendacje ekipy...
      </p>

      <style>{`
        @keyframes scanLine {
          0% { top: 0% }
          100% { top: 100% }
        }
      `}</style>
    </div>
  )
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
  const matches = place.tags.filter(t => groupActivities.includes(t))
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
              {place.region === 'budapest' ? '🇭🇺' : '🇸🇮'} {place.subregion || (place.region === 'budapest' ? 'Budapeszt' : 'Słowenia')}
            </span>
            {isMatch && (
              <span className="text-xs text-forest-500 bg-forest-800/20 px-2 py-0.5 rounded-full border border-forest-700/20">
                ✓ pasuje do ekipy
              </span>
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
        {place.tags.map(tag => (
          <span key={tag} className={`text-xs px-2 py-0.5 rounded-full ${
            groupActivities.includes(tag)
              ? 'bg-forest-800/40 text-forest-300 border border-forest-700/30'
              : 'bg-stone-800 text-stone-500 border border-stone-700/30'
          }`}>
            {ACTIVITY_TAGS[tag] || tag}
          </span>
        ))}
        {place.estimatedCost && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-stone-800 text-stone-500 border border-stone-700/30">
            {COST_LABEL[place.estimatedCost] || place.estimatedCost}
          </span>
        )}
      </div>

      {/* Sources + sentiment + maps */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setShowSources(!showSources)}
          className="flex items-center gap-1.5 text-stone-500 hover:text-stone-300 text-xs transition-colors"
        >
          <Star className="w-3 h-3" />
          {place.sourceCount}x · {place.sentiment}
          <ChevronDown className={`w-3 h-3 transition-transform ${showSources ? 'rotate-180' : ''}`} />
        </button>
        {place.lat && place.lon && (
          <a
            href={`https://maps.google.com/?q=${place.lat},${place.lon}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-water-400 hover:text-water-300 text-xs transition-colors"
          >
            <MapPin className="w-3 h-3" /> Google Maps
          </a>
        )}
      </div>

      {/* Reddit sources */}
      {showSources && place.sources?.length > 0 && (
        <div className="space-y-1.5 border-t border-stone-700/40 pt-2">
          {place.sources.map((s, i) => (
            <a key={i} href={s.url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 text-xs text-water-400 hover:text-water-300 transition-colors">
              <ExternalLink className="w-3 h-3 flex-shrink-0" />
              <span className="truncate">{s.title}</span>
              <span className="text-stone-600 flex-shrink-0">↑{s.score}</span>
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
export default function PlacesTab({ room, myPrefs, allPrefs }: Props) {
  const [aiPlaces, setAiPlaces] = useState<AIPlace[]>([])
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([])
  const [loading, setLoading] = useState(false)
  const [searchCount, setSearchCount] = useState(0)
  const [fadingOut, setFadingOut] = useState(false)
  const [resultsVisible, setResultsVisible] = useState(false)
  const [scanPhase, setScanPhase] = useState(0)
  const [postsScanned, setPostsScanned] = useState(0)
  const [activeRegion, setActiveRegion] = useState<'all' | 'budapest' | 'slovenia'>('all')
  const [showAll, setShowAll] = useState(false)
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [error, setError] = useState('')
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
    loadSavedRecommendations()
  }, [room.id])

  async function loadSavedRecommendations() {
    const { data } = await supabase
      .from('ai_recommendations')
      .select('*')
      .eq('room_id', room.id)
      .order('created_at', { ascending: false })
      .limit(1)
    if (data && data.length > 0) {
      setAiPlaces(data[0].places || [])
      setPostsScanned(data[0].posts_analyzed || 0)
    }
  }

  async function saveRecommendations(places: AIPlace[], analyzed: number) {
    // Usuń stare i zapisz nowe
    await supabase.from('ai_recommendations').delete().eq('room_id', room.id)
    await supabase.from('ai_recommendations').insert({
      room_id: room.id,
      region: activeRegion,
      places,
      posts_analyzed: analyzed,
    })
  }

  async function loadSavedPlaces() {
    const { data } = await supabase.from('saved_places').select('*').eq('room_id', room.id)
    setSavedPlaces(data || [])
  }

  async function handleSearchMore() {
    // Szuka kolejnej partii i dodaje do istniejących
    const region = activeRegion === 'all' ? 'slovenia' : activeRegion
    let posts: any[] = []
    try { posts = await fetchRedditFromBrowser(groupActivities, region) } catch {}

    const tripDays = room.start_date && room.end_date
      ? Math.ceil((new Date(room.end_date).getTime() - new Date(room.start_date).getTime()) / 86400000)
      : null

    const payload = {
      posts,
      activities: groupActivities,
      region,
      transport: myPrefs.transport || myPrefs.accommodation,
      accommodation: myPrefs.accommodation,
      intensity: myPrefs.intensity,
      numPeople: room.num_people || 4,
      startDate: room.start_date,
      endDate: room.end_date,
      tripDays,
      batch: 2,
    }

    try {
      const res = await fetch('/api/places', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        const data = await res.json()
        const newPlaces = (data.places || []).filter(
          (np: AIPlace) => !aiPlaces.find(ep => ep.name === np.name)
        )
        const updated = [...aiPlaces, ...newPlaces]
        for (const place of newPlaces) {
          await new Promise(r => setTimeout(r, 150))
          setAiPlaces(prev => [...prev, place])
        }
        await saveRecommendations(updated, posts.length)
      }
    } catch {}
  }

  async function handleSearch() {
    setLoading(true)
    setError('')
    setAiPlaces([])
    setResultsVisible(false)
    setScanPhase(0)
    setPostsScanned(0)
    setSearchCount(c => c + 1)
    setScanPhase(0)
    setPostsScanned(0)

    const region = activeRegion === 'all' ? 'slovenia' : activeRegion

    // Pobierz posty z Reddit z przeglądarki
    let posts: any[] = []
    try {
      posts = await fetchRedditFromBrowser(groupActivities, region)
      setPostsScanned(posts.length)
    } catch {}

    setScanPhase(1)

    const tripDays = room.start_date && room.end_date
      ? Math.ceil((new Date(room.end_date).getTime() - new Date(room.start_date).getTime()) / 86400000)
      : null

    const payload = {
      posts,
      activities: groupActivities,
      region,
      transport: myPrefs.transport || myPrefs.accommodation,
      accommodation: myPrefs.accommodation,
      intensity: myPrefs.intensity,
      numPeople: room.num_people || 4,
      startDate: room.start_date,
      endDate: room.end_date,
      tripDays,
    }

    try {
      // Batch 1 — pierwsze 10 miejsc
      setScanPhase(2)
      const res1 = await fetch('/api/places', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, batch: 1 }),
      })

      if (!res1.ok) throw new Error('Błąd API')
      const data1 = await res1.json()
      setScanPhase(3)
      // Fade out animacji
      setFadingOut(true)
      await new Promise(r => setTimeout(r, 500))
      const firstBatch = data1.places || []
      setAiPlaces(firstBatch)
      setLoading(false)
      setFadingOut(false)
      // Fade in wyników
      await new Promise(r => setTimeout(r, 50))
      setResultsVisible(true)

      // Batch 2 — kolejne 10 miejsc w tle
      const res2 = await fetch('/api/places', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, batch: 2 }),
      })

      let allPlaces = [...firstBatch]
      if (res2.ok) {
        const data2 = await res2.json()
        for (const place of (data2.places || [])) {
          await new Promise(r => setTimeout(r, 150))
          allPlaces = [...allPlaces, place]
          setAiPlaces(prev => [...prev, place])
        }
      }

      // Zapisz wszystkie wyniki
      await saveRecommendations(allPlaces, posts.length)
    } catch (e) {
      setError('Nie udało się pobrać rekomendacji. Sprawdź połączenie.')
      setLoading(false)
    }
  }

  async function savePlace(place: AIPlace) {
    if (savedPlaces.find(s => s.place_name === place.name)) return
    const { data } = await supabase.from('saved_places').insert({
      room_id: room.id,
      place_name: place.name,
      place_data: { description: place.description, activities: place.tags, sources: place.sourceCount, sentiment: place.sentiment, region: place.region, subregion: place.subregion },
      votes: 1, voters: [sessionId], notes: [], tags: place.tags,
    }).select().single()
    if (data) setSavedPlaces(prev => [...prev, data])
  }

  async function votePlace(placeId: string, voters: string[], votes: number) {
    const hasVoted = voters.includes(sessionId)
    const newVoters = hasVoted ? voters.filter(v => v !== sessionId) : [...voters, sessionId]
    const { data } = await supabase.from('saved_places').update({ votes: hasVoted ? votes - 1 : votes + 1, voters: newVoters }).eq('id', placeId).select().single()
    if (data) setSavedPlaces(prev => prev.map(p => p.id === placeId ? data : p))
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
    return regionOk && tagOk
  })
  const matchingPlaces = filteredPlaces.filter(p => p.tags.some(t => groupActivities.includes(t)))
  const otherPlaces = filteredPlaces.filter(p => !p.tags.some(t => groupActivities.includes(t)))

  return (
    <div className="px-4 py-5 max-w-lg mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold text-stone-100">Rekomendacje miejsc</h2>
        {aiPlaces.length > 0 && (
          <span className="text-xs text-stone-500 bg-stone-800 px-2.5 py-1 rounded-full">
            {postsScanned} postów
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

      {/* Region filter */}
      <div className="flex gap-2">
        {[{ id: 'all', label: '🗺️ Wszystkie' }, { id: 'budapest', label: '🇭🇺 Budapeszt' }, { id: 'slovenia', label: '🇸🇮 Słowenia' }].map(r => (
          <button key={r.id} onClick={() => setActiveRegion(r.id as any)}
            className={`flex-1 py-2 rounded-xl text-xs font-medium transition-all ${
              activeRegion === r.id ? 'bg-stone-700 text-stone-100 border border-stone-600' : 'bg-stone-800/40 text-stone-500 border border-stone-700/40'
            }`}>
            {r.label}
          </button>
        ))}
      </div>

      {/* Przyciski */}
      {!loading && (
        <div className="flex gap-2">
          <button onClick={handleSearch}
            className="flex-1 flex items-center justify-center gap-2 bg-gradient-to-r from-forest-700 to-water-700 hover:from-forest-600 hover:to-water-600 text-white rounded-2xl py-4 font-semibold text-sm transition-all active:scale-95 shadow-lg">
            <RefreshCw className="w-4 h-4" />
            {aiPlaces.length > 0 ? 'Odśwież' : 'Szukaj dla ekipy'}
          </button>
          {aiPlaces.length > 0 && (
            <button onClick={handleSearchMore}
              className="flex items-center justify-center gap-2 bg-stone-800 hover:bg-stone-700 border border-stone-700 text-stone-300 rounded-2xl px-4 font-semibold text-sm transition-all active:scale-95">
              + Więcej
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
        <GlobeAnimation key={searchCount} postsScanned={postsScanned} phase={scanPhase} totalPosts={25} />
      </div>

      {/* Błąd */}
      {error && <p className="text-red-400 text-xs bg-red-400/10 rounded-xl px-4 py-3">{error}</p>}

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

      {/* Wyniki */}
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
                  key={place.name}
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
                    <PlaceCard key={place.name} place={place} groupActivities={groupActivities}
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
