'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase, ItineraryItem } from '@/lib/supabase'

// Dane potrzebne do utworzenia przystanku w dniu. Wszystko opcjonalne poza nazwą.
export type NewStop = {
  place_name: string
  place_id?: string | null
  lat?: number | null
  lon?: number | null
  saved_place_id?: string | null
  opening_hours?: string[] | null
  tags?: string[]
  duration_min?: number | null
}

// Hook zarządzający planerem dni (tabela itinerary_items) z synchronizacją
// w czasie rzeczywistym. Zapisy są optymistyczne (natychmiastowa reakcja UI),
// a realtime dociąga prawdę z bazy i godzi stan między urządzeniami.
export function useItinerary(roomId: string, sessionId: string) {
  const [items, setItems] = useState<ItineraryItem[]>([])
  const [loading, setLoading] = useState(true)
  // Znacznik ostatniej lokalnej mutacji — pozwala chwilę zignorować echo realtime,
  // żeby optymistyczny stan nie „mrugał" tuż po zapisie.
  const lastLocalWrite = useRef(0)

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('itinerary_items')
      .select('*')
      .eq('room_id', roomId)
      .order('day_index', { ascending: true })
      .order('position', { ascending: true })
    setItems((data as ItineraryItem[]) || [])
    setLoading(false)
  }, [roomId])

  useEffect(() => {
    load()
  }, [load])

  // Realtime: po każdej zmianie w tabeli dociągamy świeżą listę. Pomijamy odświeżenie
  // przez ~600 ms po własnym zapisie (echo własnej mutacji).
  useEffect(() => {
    const channel = supabase
      .channel(`itinerary:${roomId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'itinerary_items', filter: `room_id=eq.${roomId}` },
        () => {
          if (Date.now() - lastLocalWrite.current < 600) return
          load()
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [roomId, load])

  // Kolejna pozycja na końcu danego dnia.
  const nextPosition = useCallback(
    (dayIndex: number) => {
      const inDay = items.filter((it) => it.day_index === dayIndex)
      return inDay.length ? Math.max(...inDay.map((it) => it.position)) + 1 : 0
    },
    [items],
  )

  const addStop = useCallback(
    async (dayIndex: number, stop: NewStop) => {
      lastLocalWrite.current = Date.now()
      const position = nextPosition(dayIndex)
      const row = {
        room_id: roomId,
        day_index: dayIndex,
        position,
        place_name: stop.place_name,
        place_id: stop.place_id ?? null,
        lat: stop.lat ?? null,
        lon: stop.lon ?? null,
        saved_place_id: stop.saved_place_id ?? null,
        start_time: null as string | null,
        duration_min: stop.duration_min ?? 90,
        opening_hours: stop.opening_hours ?? null,
        tags: stop.tags ?? [],
        note: null as string | null,
        session_id: sessionId,
      }
      const { data } = await supabase.from('itinerary_items').insert(row).select().single()
      if (data) setItems((prev) => [...prev, data as ItineraryItem])
    },
    [roomId, sessionId, nextPosition],
  )

  // Dodanie wielu przystanków naraz, z zachowaniem kolejności (rosnące position).
  // Jeden insert — unika problemu nieświeżej pozycji przy pętli addStop.
  const addStops = useCallback(
    async (dayIndex: number, stops: NewStop[]) => {
      if (!stops.length) return
      lastLocalWrite.current = Date.now()
      let pos = nextPosition(dayIndex)
      const rows = stops.map((stop) => ({
        room_id: roomId,
        day_index: dayIndex,
        position: pos++,
        place_name: stop.place_name,
        place_id: stop.place_id ?? null,
        lat: stop.lat ?? null,
        lon: stop.lon ?? null,
        saved_place_id: stop.saved_place_id ?? null,
        start_time: null as string | null,
        duration_min: stop.duration_min ?? 90,
        opening_hours: stop.opening_hours ?? null,
        tags: stop.tags ?? [],
        note: null as string | null,
        session_id: sessionId,
      }))
      const { data } = await supabase.from('itinerary_items').insert(rows).select()
      if (data) setItems((prev) => [...prev, ...(data as ItineraryItem[])])
    },
    [roomId, sessionId, nextPosition],
  )

  const removeStop = useCallback(async (id: string) => {
    lastLocalWrite.current = Date.now()
    setItems((prev) => prev.filter((it) => it.id !== id))
    await supabase.from('itinerary_items').delete().eq('id', id)
  }, [])

  const updateStop = useCallback(
    async (id: string, patch: Partial<Pick<ItineraryItem, 'duration_min' | 'start_time' | 'note'>>) => {
      lastLocalWrite.current = Date.now()
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)))
      await supabase
        .from('itinerary_items')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id)
    },
    [],
  )

  // Przesuń przystanek w obrębie dnia o jeden w górę (-1) lub w dół (+1) —
  // zamiana wartości position z sąsiadem.
  const moveWithinDay = useCallback(
    async (id: string, dir: -1 | 1) => {
      const item = items.find((it) => it.id === id)
      if (!item) return
      const sameDay = items
        .filter((it) => it.day_index === item.day_index)
        .sort((a, b) => a.position - b.position)
      const idx = sameDay.findIndex((it) => it.id === id)
      const swapWith = sameDay[idx + dir]
      if (!swapWith) return
      lastLocalWrite.current = Date.now()
      setItems((prev) =>
        prev.map((it) => {
          if (it.id === item.id) return { ...it, position: swapWith.position }
          if (it.id === swapWith.id) return { ...it, position: item.position }
          return it
        }),
      )
      await Promise.all([
        supabase.from('itinerary_items').update({ position: swapWith.position }).eq('id', item.id),
        supabase.from('itinerary_items').update({ position: item.position }).eq('id', swapWith.id),
      ])
    },
    [items],
  )

  // Przenieś przystanek do innego dnia (na koniec dnia docelowego).
  const moveToDay = useCallback(
    async (id: string, dayIndex: number) => {
      const item = items.find((it) => it.id === id)
      if (!item || item.day_index === dayIndex) return
      lastLocalWrite.current = Date.now()
      const position = nextPosition(dayIndex)
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, day_index: dayIndex, position } : it)))
      await supabase
        .from('itinerary_items')
        .update({ day_index: dayIndex, position, updated_at: new Date().toISOString() })
        .eq('id', id)
    },
    [items, nextPosition],
  )

  return { items, loading, addStop, addStops, removeStop, updateStop, moveWithinDay, moveToDay }
}
