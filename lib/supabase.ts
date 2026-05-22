import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
})

export type Database = {
  rooms: Room
  user_preferences: UserPreference
  packing_items: PackingItem
  saved_places: SavedPlace
}

export type Room = {
  id: string
  code: string
  created_at: string
  start_city: string
  end_city: string
  start_date: string | null
  trip_name: string
}

export type UserPreference = {
  id: string
  room_id: string
  session_id: string
  user_name: string
  activities: string[]
  intensity: 'slow' | 'balanced' | 'intense'
  accommodation: 'van_only' | 'van_plus' | 'flexible'
  food: string[]
  completed: boolean
  created_at: string
  updated_at: string
}

export type PackingItem = {
  id: string
  room_id: string
  category: string
  name: string
  checked: boolean
  added_by: string
  added_by_session: string
  created_at: string
}

export type SavedPlace = {
  id: string
  room_id: string
  place_name: string
  place_data: PlaceData
  votes: number
  voters: string[]
  notes: PlaceNote[]
  tags: string[]
  created_at: string
}

export type PlaceData = {
  description?: string
  coordinates?: [number, number]
  activities?: string[]
  sources?: number
  sentiment?: string
  region?: 'budapest' | 'slovenia'
  thumbnail?: string
}

export type PlaceNote = {
  session_id: string
  user_name: string
  text: string
  created_at: string
}
