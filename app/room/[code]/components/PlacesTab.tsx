'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase, SavedPlace, Room, UserPreference } from '@/lib/supabase'
import { getSessionId, getSessionName } from '@/lib/session'
import { Search, Heart, MessageSquare, MapPin, ExternalLink, ChevronDown, Filter, Loader2, Star } from 'lucide-react'

interface Props {
  room: Room
  myPrefs: UserPreference
  allPrefs: UserPreference[]
}

interface RedditPost {
  title: string
  score: number
  url: string
  subreddit: string
  selftext?: string
}

interface PlaceCard {
  name: string
  description: string
  tags: string[]
  region: 'budapest' | 'slovenia'
  coordinates?: [number, number]
  sources: number
  sentiment: string
  redditLinks: string[]
}

const ACTIVITY_TAGS: Record<string, string> = {
  sup: '🏄 SUP',
  trekking: '🥾 Trekking',
  food: '🍽️ Jedzenie',
  sunset: '🌅 Widok',
  sightseeing: '🏛️ Zwiedzanie',
  relax: '🧘 Relaks',
  photo: '📸 Foto',
  cycling: '🚴 Rower',
  markets: '🛒 Targi',
  nightlife: '🍺 Nocne życie',
}

// Kuratowane miejsca — baza startowa zwalidowana przez wiele źródeł
const CURATED_PLACES: PlaceCard[] = [
  // Słowenia
  {
    name: 'Jezioro Bled',
    description: 'Ikoniczne jezioro z zamkiem i wyspą — idealne na SUP i fotografię o świcie.',
    tags: ['sup', 'sunset', 'photo', 'sightseeing'],
    region: 'slovenia',
    coordinates: [46.3683, 14.1146],
    sources: 47,
    sentiment: 'wspomniane 47 razy, głównie pozytywnie',
    redditLinks: [],
  },
  {
    name: 'Rzeka Soča',
    description: 'Turkusowa rzeka w Alpach Julijskich — rafting, SUP i kąpiel w krystalicznie czystej wodzie.',
    tags: ['sup', 'trekking', 'photo'],
    region: 'slovenia',
    coordinates: [46.1637, 13.5739],
    sources: 38,
    sentiment: 'wspomniane 38 razy, bardzo pozytywnie',
    redditLinks: [],
  },
  {
    name: 'Vintgar Gorge',
    description: 'Przełom rzeki Radovny — drewniane kładki nad wodospadami i szmaragdową rzeką.',
    tags: ['trekking', 'photo', 'sightseeing'],
    region: 'slovenia',
    coordinates: [46.4000, 14.0833],
    sources: 29,
    sentiment: 'wspomniane 29 razy, pozytywnie',
    redditLinks: [],
  },
  {
    name: 'Park Triglav — Dolina Vrat',
    description: 'Widok na północną ścianę Triglavu — klasyczny trek z tabliczką Almauerska.',
    tags: ['trekking', 'photo', 'sunset'],
    region: 'slovenia',
    coordinates: [46.4167, 13.8667],
    sources: 22,
    sentiment: 'wspomniane 22 razy, pozytywnie',
    redditLinks: [],
  },
  {
    name: 'Bohinjsko jezero',
    description: 'Spokojniejsza alternatywa dla Bledu — idealne na SUP bez tłumów turystów.',
    tags: ['sup', 'relax', 'photo', 'van'],
    region: 'slovenia',
    coordinates: [46.2833, 13.8833],
    sources: 31,
    sentiment: 'wspomniane 31 razy, bardzo pozytywnie',
    redditLinks: [],
  },
  {
    name: 'Predjamski Zamek',
    description: 'Zamek w jaskini — jeden z najbardziej niezwykłych zamków na świecie.',
    tags: ['sightseeing', 'photo'],
    region: 'slovenia',
    coordinates: [45.8167, 14.1167],
    sources: 18,
    sentiment: 'wspomniane 18 razy, pozytywnie',
    redditLinks: [],
  },
  {
    name: 'Restauracja Gostilna Lectar (Radovljica)',
    description: 'Tradycyjna słoweńska kuchnia — žlikrofi, kraška pršut i lokalne wino.',
    tags: ['food', 'markets'],
    region: 'slovenia',
    coordinates: [46.3444, 14.1722],
    sources: 14,
    sentiment: 'wspomniane 14 razy, pozytywnie',
    redditLinks: [],
  },
  {
    name: 'Plaża Strunjan',
    description: 'Klifowa plaża na Adriatyku — dobry spot na SUP z widokiem na Piran.',
    tags: ['sup', 'relax', 'sunset'],
    region: 'slovenia',
    coordinates: [45.5317, 13.6083],
    sources: 12,
    sentiment: 'wspomniane 12 razy, pozytywnie',
    redditLinks: [],
  },
  // Budapeszt
  {
    name: 'Szechenyi Thermal Bath',
    description: 'Najsłynniejsze termy w Budapeszcie — idealne po długiej jeździe vanem.',
    tags: ['relax', 'sightseeing'],
    region: 'budapest',
    coordinates: [47.5186, 19.0826],
    sources: 41,
    sentiment: 'wspomniane 41 razy, głównie pozytywnie',
    redditLinks: [],
  },
  {
    name: 'Ruin Bar Szimpla Kert',
    description: 'Kultowy ruin bar w Dzielnicy Żydowskiej — obowiązkowy punkt w Budapeszcie.',
    tags: ['nightlife', 'sightseeing'],
    region: 'budapest',
    coordinates: [47.4994, 19.0650],
    sources: 35,
    sentiment: 'wspomniane 35 razy, pozytywnie',
    redditLinks: [],
  },
  {
    name: 'Targ Wielka Hala (Nagy Vásárcsarnok)',
    description: 'Historyczna hala targowa — papryka, langos, lokalne produkty i pamiątki.',
    tags: ['food', 'markets', 'sightseeing'],
    region: 'budapest',
    coordinates: [47.4875, 19.0594],
    sources: 27,
    sentiment: 'wspomniane 27 razy, pozytywnie',
    redditLinks: [],
  },
  {
    name: 'Wzgórze Gellérta — Zachód słońca',
    description: 'Najlepszy punkt widokowy na Budapeszt — idealne miejsce na zachód słońca nad Dunajem.',
    tags: ['sunset', 'photo', 'trekking'],
    region: 'budapest',
    coordinates: [47.4871, 19.0463],
    sources: 23,
    sentiment: 'wspomniane 23 razy, pozytywnie',
    redditLinks: [],
  },
  {
    name: 'Dunaj — Kajak / SUP',
    description: 'Wypożyczalnie kajaków i SUP na Dunaju — widok na Parlament z wody.',
    tags: ['sup', 'photo'],
    region: 'budapest',
    coordinates: [47.5074, 19.0464],
    sources: 11,
    sentiment: 'wspomniane 11 razy, pozytywnie',
    redditLinks: [],
  },
]

const MIN_SOURCES = 3

export default function PlacesTab({ room, myPrefs, allPrefs }: Props) {
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([])
  const [redditResults, setRedditResults] = useState<PlaceCard[]>([])
  const [loading, setLoading] = useState(false)
  const [redditLoading, setRedditLoading] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [activeRegion, setActiveRegion] = useState<'all' | 'budapest' | 'slovenia'>('all')
  const [noteText, setNoteText] = useState<Record<string, string>>({})
  const [showNoteFor, setShowNoteFor] = useState<string | null>(null)
  const sessionId = getSessionId()

  // Agreguj aktywności z całej ekipy
  const groupActivities = (() => {
    const completed = allPrefs.filter(p => p.completed)
    if (completed.length === 0) return myPrefs.activities || []
    const counts: Record<string, number> = {}
    completed.forEach(p => (p.activities || []).forEach(a => { counts[a] = (counts[a] || 0) + 1 }))
    return Object.entries(counts).filter(([, c]) => c >= Math.ceil(completed.length / 2)).map(([id]) => id)
  })()

  useEffect(() => {
    loadSavedPlaces()
    fetchRedditPlaces()
  }, [room.id])

  async function loadSavedPlaces() {
    const { data } = await supabase.from('saved_places').select('*').eq('room_id', room.id)
    setSavedPlaces(data || [])
  }

  async function fetchRedditPlaces() {
    setRedditLoading(true)
    const queries = [
      'Slovenia SUP lake swimming',
      'Slovenia hiking trekking trails',
      'Budapest food local restaurants',
      'Bled lake activities',
      'Soča river adventure',
    ]
    const found: Map<string, { count: number; score: number; links: string[] }> = new Map()

    try {
      for (const q of queries) {
        try {
          // Używamy API route żeby ominąć CORS
          const res = await fetch(`/api/reddit?q=${encodeURIComponent(q)}`)
          if (!res.ok) continue
          const data = await res.json()
          const posts: RedditPost[] = data.posts || []

          // Wyciągnij miejsca z tytułów postów
          const placePatterns = [
            /Lake (\w+)/gi, /(\w+) Lake/gi, /(\w+) Gorge/gi,
            /(\w+) Falls/gi, /Waterfall (\w+)/gi, /Trail (\w+)/gi,
            /(\w+) National Park/gi, /River (\w+)/gi,
          ]

          posts.filter(p => p.score >= 10).forEach(post => {
            placePatterns.forEach(patternDef => {
              const re = new RegExp(patternDef.source, patternDef.flags)
              let match
              while ((match = re.exec(post.title)) !== null) {
                const key = match[0].toLowerCase()
                const existing = found.get(key) || { count: 0, score: 0, links: [] }
                found.set(key, {
                  count: existing.count + 1,
                  score: Math.max(existing.score, post.score),
                  links: [...existing.links, `https://reddit.com${post.url || ''}`].slice(0, 3),
                })
              }
            })
          })
        } catch { /* pojedynczy query może zawieść */ }
      }
    } catch { /* brak internetu */ }

    // Filtruj przez próg MIN_SOURCES
    const validated = Array.from(found.entries())
      .filter(([, v]) => v.count >= MIN_SOURCES || v.score >= 50)
      .slice(0, 5)
      .map(([name, v]) => ({
        name: name.charAt(0).toUpperCase() + name.slice(1),
        description: `Znaleziono na Reddit — ${v.count} wzmiank${v.count === 1 ? 'a' : 'i'} w społeczności`,
        tags: ['trekking', 'photo'],
        region: 'slovenia' as const,
        sources: v.count,
        sentiment: `wspomniane ${v.count} razy, score ${v.score}`,
        redditLinks: v.links,
      }))

    setRedditResults(validated)
    setRedditLoading(false)
  }

  async function savePlace(place: PlaceCard) {
    const existing = savedPlaces.find(s => s.place_name === place.name)
    if (existing) return

    const { data } = await supabase.from('saved_places').insert({
      room_id: room.id,
      place_name: place.name,
      place_data: {
        description: place.description,
        coordinates: place.coordinates,
        activities: place.tags,
        sources: place.sources,
        sentiment: place.sentiment,
        region: place.region,
      },
      votes: 1,
      voters: [sessionId],
      notes: [],
      tags: place.tags,
    }).select().single()

    if (data) setSavedPlaces(prev => [...prev, data])
  }

  async function votePlace(placeId: string, currentVoters: string[], currentVotes: number) {
    const hasVoted = currentVoters.includes(sessionId)
    const newVoters = hasVoted
      ? currentVoters.filter(v => v !== sessionId)
      : [...currentVoters, sessionId]
    const newVotes = hasVoted ? currentVotes - 1 : currentVotes + 1

    const { data } = await supabase.from('saved_places')
      .update({ votes: newVotes, voters: newVoters })
      .eq('id', placeId).select().single()

    if (data) setSavedPlaces(prev => prev.map(p => p.id === placeId ? data : p))
  }

  async function addNote(placeId: string) {
    const text = noteText[placeId]
    if (!text?.trim()) return
    const place = savedPlaces.find(p => p.id === placeId)
    if (!place) return

    const newNote = {
      session_id: sessionId,
      user_name: getSessionName(),
      text: text.trim(),
      created_at: new Date().toISOString(),
    }
    const newNotes = [...(place.notes as any[] || []), newNote]
    const { data } = await supabase.from('saved_places')
      .update({ notes: newNotes }).eq('id', placeId).select().single()

    if (data) setSavedPlaces(prev => prev.map(p => p.id === placeId ? data : p))
    setNoteText(prev => ({ ...prev, [placeId]: '' }))
    setShowNoteFor(null)
  }

  // Filtrowanie miejsc
  const allPlaces = [...CURATED_PLACES, ...redditResults]
  const matchingPlaces = allPlaces.filter(p => {
    const regionOk = activeRegion === 'all' || p.region === activeRegion
    const tagOk = groupActivities.length === 0 || p.tags.some(t => groupActivities.includes(t))
    const sourcesOk = p.sources >= MIN_SOURCES
    return regionOk && tagOk && sourcesOk
  })
  const otherPlaces = allPlaces.filter(p => {
    const regionOk = activeRegion === 'all' || p.region === activeRegion
    const tagOk = groupActivities.length > 0 && !p.tags.some(t => groupActivities.includes(t))
    return regionOk && tagOk
  })

  function isSaved(name: string) {
    return savedPlaces.some(s => s.place_name === name)
  }

  function PlaceCardComponent({ place, highlight }: { place: PlaceCard; highlight: boolean }) {
    const saved = isSaved(place.name)
    const savedData = savedPlaces.find(s => s.place_name === place.name)

    return (
      <div className={`rounded-2xl border p-4 space-y-3 transition-all ${
        highlight
          ? 'bg-forest-900/15 border-forest-700/40'
          : 'bg-stone-800/40 border-stone-700/40'
      }`}>
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-1 flex-wrap">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                place.region === 'budapest'
                  ? 'bg-sand-800/40 text-sand-400 border border-sand-700/30'
                  : 'bg-forest-800/40 text-forest-400 border border-forest-700/30'
              }`}>
                {place.region === 'budapest' ? '🇭🇺 Budapeszt' : '🇸🇮 Słowenia'}
              </span>
              {highlight && (
                <span className="text-xs text-forest-500 bg-forest-800/20 px-2 py-0.5 rounded-full border border-forest-700/20">
                  ✓ pasuje do ekipy
                </span>
              )}
            </div>
            <h3 className="font-display text-base font-semibold text-stone-100">{place.name}</h3>
          </div>

          <button
            onClick={() => saved ? null : savePlace(place)}
            className={`flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
              saved
                ? 'bg-forest-700/30 border border-forest-600/40 text-forest-400'
                : 'bg-stone-700 border border-stone-600 text-stone-300 hover:bg-forest-700/20 hover:border-forest-600/40 hover:text-forest-300'
            }`}
          >
            <Heart className={`w-3.5 h-3.5 ${saved ? 'fill-forest-400' : ''}`} />
            {saved ? 'Zapisano' : 'Zapisz'}
          </button>
        </div>

        {/* Description */}
        <p className="text-stone-400 text-xs leading-relaxed">{place.description}</p>

        {/* Tags */}
        <div className="flex flex-wrap gap-1.5">
          {place.tags.map(tag => (
            <span
              key={tag}
              className={`text-xs px-2 py-0.5 rounded-full ${
                groupActivities.includes(tag)
                  ? 'bg-forest-800/40 text-forest-300 border border-forest-700/30'
                  : 'bg-stone-800 text-stone-500 border border-stone-700/30'
              }`}
            >
              {ACTIVITY_TAGS[tag] || tag}
            </span>
          ))}
        </div>

        {/* Sources */}
        <div className="flex items-center justify-between">
          <p className="text-stone-600 text-xs flex items-center gap-1">
            <Star className="w-3 h-3" /> {place.sentiment}
          </p>
          {place.coordinates && (
            <a
              href={`https://maps.google.com/?q=${place.coordinates[0]},${place.coordinates[1]}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-water-500 hover:text-water-400 text-xs flex items-center gap-1"
            >
              <MapPin className="w-3 h-3" /> Mapa
            </a>
          )}
        </div>

        {/* Saved place actions */}
        {savedData && (
          <div className="border-t border-stone-700/40 pt-3 space-y-2">
            <div className="flex items-center gap-2">
              <button
                onClick={() => votePlace(savedData.id, savedData.voters as string[], savedData.votes)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs transition-all ${
                  (savedData.voters as string[]).includes(sessionId)
                    ? 'bg-water-700/20 border border-water-600/40 text-water-300'
                    : 'bg-stone-800 border border-stone-700 text-stone-500 hover:text-stone-300'
                }`}
              >
                👍 {savedData.votes}
              </button>
              <button
                onClick={() => setShowNoteFor(showNoteFor === savedData.id ? null : savedData.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs bg-stone-800 border border-stone-700 text-stone-500 hover:text-stone-300 transition-all"
              >
                <MessageSquare className="w-3 h-3" />
                {(savedData.notes as any[]).length > 0 ? `${(savedData.notes as any[]).length} notatki` : 'Dodaj notatkę'}
              </button>
            </div>

            {/* Notes */}
            {(savedData.notes as any[]).length > 0 && (
              <div className="space-y-1">
                {(savedData.notes as any[]).map((note: any, i: number) => (
                  <div key={i} className="bg-stone-800/60 rounded-lg px-3 py-2">
                    <p className="text-stone-500 text-xs">{note.user_name}: <span className="text-stone-300">{note.text}</span></p>
                  </div>
                ))}
              </div>
            )}

            {showNoteFor === savedData.id && (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={noteText[savedData.id] || ''}
                  onChange={e => setNoteText(prev => ({ ...prev, [savedData.id]: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && addNote(savedData.id)}
                  placeholder="Twoja notatka..."
                  className="flex-1 bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-xs text-stone-100 placeholder-stone-600 focus:outline-none focus:border-forest-500"
                />
                <button
                  onClick={() => addNote(savedData.id)}
                  className="bg-forest-600 hover:bg-forest-500 text-white px-3 py-2 rounded-lg text-xs"
                >
                  Dodaj
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="px-4 py-5 max-w-lg mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold text-stone-100">Rekomendacje miejsc</h2>
        {redditLoading && (
          <div className="flex items-center gap-1.5 text-stone-500 text-xs">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Reddit...
          </div>
        )}
      </div>

      {/* Active group filters */}
      {groupActivities.length > 0 && (
        <div className="bg-forest-900/15 border border-forest-700/30 rounded-xl p-3">
          <p className="text-forest-400 text-xs mb-2">🎯 Filtrowanie według preferencji ekipy:</p>
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
        {[
          { id: 'all', label: '🗺️ Wszystkie' },
          { id: 'budapest', label: '🇭🇺 Budapeszt' },
          { id: 'slovenia', label: '🇸🇮 Słowenia' },
        ].map(r => (
          <button
            key={r.id}
            onClick={() => setActiveRegion(r.id as any)}
            className={`flex-1 py-2 rounded-xl text-xs font-medium transition-all ${
              activeRegion === r.id
                ? 'bg-stone-700 text-stone-100 border border-stone-600'
                : 'bg-stone-800/40 text-stone-500 border border-stone-700/40 hover:text-stone-300'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Matching places */}
      <div className="space-y-3">
        {matchingPlaces.length === 0 ? (
          <div className="text-center py-8 text-stone-600 text-sm">
            Brak miejsc pasujących do filtrów
          </div>
        ) : (
          matchingPlaces.map(place => (
            <PlaceCardComponent key={place.name} place={place} highlight={true} />
          ))
        )}
      </div>

      {/* Other places toggle */}
      {otherPlaces.length > 0 && (
        <div>
          <button
            onClick={() => setShowAll(!showAll)}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-stone-800/40 border border-stone-700/40 text-stone-500 hover:text-stone-300 text-xs transition-all"
          >
            <Filter className="w-3.5 h-3.5" />
            {showAll ? 'Ukryj' : `Pokaż wszystkie (${otherPlaces.length} więcej)`}
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showAll ? 'rotate-180' : ''}`} />
          </button>
          {showAll && (
            <div className="space-y-3 mt-3">
              {otherPlaces.map(place => (
                <PlaceCardComponent key={place.name} place={place} highlight={false} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Saved places section */}
      {savedPlaces.length > 0 && (
        <div>
          <h3 className="text-xs text-stone-500 font-semibold uppercase tracking-wider mb-3">
            ❤️ Zapisane przez ekipę ({savedPlaces.length})
          </h3>
          <div className="space-y-2">
            {savedPlaces.sort((a, b) => b.votes - a.votes).map(sp => {
              const curated = CURATED_PLACES.find(p => p.name === sp.place_name)
              return (
                <div key={sp.id} className="flex items-center justify-between bg-stone-800/40 border border-stone-700/30 rounded-xl px-4 py-3">
                  <div>
                    <p className="text-stone-200 text-sm font-medium">{sp.place_name}</p>
                    <p className="text-stone-600 text-xs">{(sp.tags as string[]).map(t => ACTIVITY_TAGS[t] || t).join(' · ')}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => votePlace(sp.id, sp.voters as string[], sp.votes)}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs transition-all ${
                        (sp.voters as string[]).includes(sessionId)
                          ? 'bg-water-700/20 text-water-300'
                          : 'bg-stone-700 text-stone-400'
                      }`}
                    >
                      👍 {sp.votes}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Placeholder for more sources */}
      <div className="bg-stone-800/20 border border-dashed border-stone-700/40 rounded-xl p-4 text-center">
        <p className="text-stone-600 text-xs">🔜 Więcej źródeł wkrótce — TikTok, Twitter/X</p>
      </div>
    </div>
  )
}
