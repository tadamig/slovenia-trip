'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { getSessionId, getSessionName, saveRoomToHistory, setSessionId } from '@/lib/session'
import { Room, UserPreference } from '@/lib/supabase'
import DialogFlow from './components/DialogFlow'
import AppShell from './components/AppShell'
import { Loader2 } from 'lucide-react'

export default function RoomPage() {
  const params = useParams()
  const code = (params.code as string).toUpperCase()
  const sessionId = typeof window !== 'undefined' ? getSessionId() : ''

  const [room, setRoom] = useState<Room | null>(null)
  const [myPrefs, setMyPrefs] = useState<UserPreference | null>(null)
  const [allPrefs, setAllPrefs] = useState<UserPreference[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

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
        .single()

      // Jeśli nie ma preferencji — spróbuj znaleźć po imieniu i przywróć session_id
      if (!myPrefsData) {
        const name = getSessionName()
        if (name && name !== 'Nieznajomy') {
          const { data: byName } = await supabase
            .from('user_preferences')
            .select('session_id')
            .eq('room_id', roomData.id)
            .eq('user_name', name)
            .single()

          if (byName?.session_id) {
            setSessionId(byName.session_id)
            sid = byName.session_id

            // Pobierz preferencje pod nowym session_id
            const { data: restored } = await supabase
              .from('user_preferences')
              .select('*')
              .eq('room_id', roomData.id)
              .eq('session_id', sid)
              .single()

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

  async function handleDialogComplete(prefs: Partial<UserPreference>, roomUpdates?: Partial<Room>) {
    if (!room) return
    const sid = getSessionId()
    const name = getSessionName()

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
    />
  )
}
