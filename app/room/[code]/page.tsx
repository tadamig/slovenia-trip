'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { getSessionId, getSessionName, saveRoomToHistory, setSessionId } from '@/lib/session'
import { Room, UserPreference } from '@/lib/supabase'
import DialogFlow from './components/DialogFlow'
import AppShell from './components/AppShell'
import TailoringAnimation from './components/TailoringAnimation'
import { Loader2 } from 'lucide-react'

type Prefetched = { places: any[]; baseLat: number | null; baseLon: number | null }

export default function RoomPage() {
  const params = useParams()
  const code = (params.code as string).toUpperCase()
  const sessionId = typeof window !== 'undefined' ? getSessionId() : ''

  const [room, setRoom] = useState<Room | null>(null)
  const [myPrefs, setMyPrefs] = useState<UserPreference | null>(null)
  const [allPrefs, setAllPrefs] = useState<UserPreference[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  // Tor B — faza „szycia na miarę" po onboardingu + prefetch miejsc do pamięci
  const [phase, setPhase] = useState<'normal' | 'tailoring'>('normal')
  const [prefetchReady, setPrefetchReady] = useState(false)
  const [prefetched, setPrefetched] = useState<Prefetched | null>(null)

  useEffect(() => {
    if (!code) return
    loadRoom()
  }, [code])

  async function loadRoom() {
    setLoading(true)
    try {
      // Pobierz pokój
      const { data: roomData, error: roomError } = await supabase
        .from('rooms')
        .select('*')
        .eq('code', code)
        .single()

      if (roomError || !roomData) {
        setNotFound(true)
        setLoading(false)
        return
      }
      setRoom(roomData)
      // Zapisz pokój do historii
      saveRoomToHistory(roomData.code, roomData.trip_name, getSessionName())

      // Pobierz preferencje tego użytkownika
      let sid = getSessionId()
      const { data: myPrefsData } = await supabase
        .from('user_preferences')
        .select('*')
        .eq('room_id', roomData.id)
        .eq('session_id', sid)
        .maybeSingle()

      // Jeśli nie ma preferencji — spróbuj znaleźć po imieniu i przywróć session_id
      if (!myPrefsData) {
        const name = getSessionName()
        if (name && name !== 'Nieznajomy') {
          const { data: byName } = await supabase
            .from('user_preferences')
            .select('session_id')
            .eq('room_id', roomData.id)
            .eq('user_name', name)
            .maybeSingle()

          if (byName?.session_id) {
            setSessionId(byName.session_id)
            sid = byName.session_id

            // Pobierz preferencje pod nowym session_id
            const { data: restored } = await supabase
              .from('user_preferences')
              .select('*')
              .eq('room_id', roomData.id)
              .eq('session_id', sid)
              .maybeSingle()

            setMyPrefs(restored || null)
          } else {
            setMyPrefs(null)
          }
        } else {
          setMyPrefs(null)
        }
      } else {
        setMyPrefs(myPrefsData)
      }

      // Pobierz wszystkie preferencje w pokoju
      const { data: allPrefsData } = await supabase
        .from('user_preferences')
        .select('*')
        .eq('room_id', roomData.id)

      setAllPrefs(allPrefsData || [])
    } finally {
      setLoading(false)
    }
  }

  // Subskrybuj zmiany w preferencjach (realtime)
  useEffect(() => {
    if (!room) return
    const channel = supabase
      .channel(`prefs:${room.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'user_preferences',
        filter: `room_id=eq.${room.id}`,
      }, () => {
        loadRoom()
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [room?.id])

  // Prefetch miejsc do pamięci podczas animacji „szycia na miarę".
  // Bezpiecznik: `ready` zapali się nawet gdy /api/discover jest wolny lub padnie,
  // więc animacja zawsze się domknie i nigdy nie zawiesi użytkownika.
  function startPrefetch(prefs: Partial<UserPreference>, roomUpdates?: Partial<Room>) {
    const baseCity = (roomUpdates?.end_city ?? room?.end_city) || ''
    const country = (roomUpdates?.country ?? room?.country) || ''
    const activities = prefs.activities || []
    const intensity = prefs.intensity ?? myPrefs?.intensity
    const numPeople = room?.num_people || 4

    const safety = setTimeout(() => setPrefetchReady(true), 15000)

    fetch('/api/discover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseCity, country, activities,
        radius: 80, sort: 'match', intensity, numPeople,
      }),
    })
      .then(async (res) => {
        if (res.ok) {
          const g = await res.json()
          setPrefetched({
            places: g.places || [],
            baseLat: g.baseLat ?? null,
            baseLon: g.baseLon ?? null,
          })
        }
      })
      .catch(() => {})
      .finally(() => { clearTimeout(safety); setPrefetchReady(true) })
  }

  async function handleDialogComplete(prefs: Partial<UserPreference>, roomUpdates?: Partial<Room>) {
    if (!room) return
    const sid = getSessionId()
    const name = getSessionName()

    // Tor B: natychmiast przełącz na animację i wystartuj prefetch w tle
    setPhase('tailoring')
    setPrefetchReady(false)
    setPrefetched(null)
    startPrefetch(prefs, roomUpdates)

    // Uaktualnij pokój jeśli są zmiany (np. data, miasto)
    if (roomUpdates && Object.keys(roomUpdates).length > 0) {
      await supabase.from('rooms').update(roomUpdates).eq('id', room.id)
      setRoom(prev => prev ? { ...prev, ...roomUpdates } : prev)
    }

    // Upsert preferencji użytkownika
    const { data, error } = await supabase
      .from('user_preferences')
      .upsert({
        room_id: room.id,
        session_id: sid,
        user_name: name,
        ...prefs,
        completed: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'room_id,session_id' })
      .select()
      .single()

    if (data) {
      setMyPrefs(data)
    }
    await loadRoom()
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-950">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-forest-400 animate-spin" />
          <p className="text-stone-500 text-sm">Ładowanie pokoju...</p>
        </div>
      </div>
    )
  }

  if (notFound) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-950 px-4">
        <div className="text-center">
          <div className="text-5xl mb-4">🗺️</div>
          <h2 className="font-display text-2xl text-stone-100 mb-2">Nie znaleziono pokoju</h2>
          <p className="text-stone-500 text-sm mb-6">Kod <strong className="text-stone-300 font-mono">{code}</strong> nie istnieje.</p>
          <a href="/" className="bg-forest-600 hover:bg-forest-500 text-white px-6 py-3 rounded-xl text-sm font-semibold transition-colors">
            Wróć na start
          </a>
        </div>
      </div>
    )
  }

  if (!room) return null

  // Tor B: po zakończeniu dialogu pokazujemy animację „szycia na miarę",
  // a w tle prefetchujemy miejsca. „Boom" domyka się, gdy dane są w pamięci.
  if (phase === 'tailoring') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-950">
        <TailoringAnimation
          ready={prefetchReady}
          onComplete={() => setPhase('normal')}
        />
      </div>
    )
  }

  // Jeśli użytkownik nie przeszedł dialogu → pokaż dialog
  if (!myPrefs?.completed) {
    return (
      <DialogFlow
        room={room}
        existingPrefs={myPrefs}
        allPrefs={allPrefs}
        onComplete={handleDialogComplete}
      />
    )
  }

  // Główna aplikacja
  return (
    <AppShell
      room={room}
      myPrefs={myPrefs}
      allPrefs={allPrefs}
      onReloadPrefs={loadRoom}
      prefetched={prefetched}
    />
  )
}
