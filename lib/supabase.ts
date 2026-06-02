import { createClient } from '@supabase/supabase-js'

// Usuwamy białe znaki i \n z kluczy (problem z Vercel env vars)
const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim()
const supabaseAnonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim()

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
})

export type Room = {
  id: string
  code: string
  created_at: string
  start_city: string
  end_city: string
  country: string
  start_city_country: string
  start_date: string | null
  end_date: string | null
  num_people: number
  transport: string
  trip_name: string
}

export type UserPreference = {
  id: string
  room_id: string
  session_id: string
  user_name: string
  activities: string[]
  intensity: 'slow' | 'balanced' | 'intense'
  accommodation: string
  transport: string
  budget: string
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
  // Pakowanie 2.0
  scope: 'shared' | 'personal'
  owner_session: string | null
  ai_generated: boolean
  ai_reason: string | null
  qty: string | null
  shared_gear: boolean
  claimed_by: string | null
  claimed_by_name: string | null
}

export type PackingProfile = {
  id: string
  room_id: string
  session_id: string
  gender: 'female' | 'male' | 'other' | 'unspecified' | null
  toggles: Record<string, boolean>
  created_at: string
  updated_at: string
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
}

export type PlaceNote = {
  session_id: string
  user_name: string
  text: string
  created_at: string
}
