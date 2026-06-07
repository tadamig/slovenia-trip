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
  subregion?: string
  // Faza 0 (mapa + planer dni): trwale trzymamy dane potrzebne do rysowania
  // markerów i liczenia tras/wykonalności dnia.
  place_id?: string
  opening_hours?: string[]   // weekday_text z Google Place Details
  google_rating?: number
  address?: string
  country?: string
}

// ——— PLANER DNI (itinerary) ———
// Jeden przystanek przypisany do konkretnego dnia wyprawy. Współdzielony w
// czasie rzeczywistym (realtime) jak reszta — dostęp przez kod pokoju.
export type ItineraryItem = {
  id: string
  room_id: string
  day_index: number          // 0-based numer dnia wyprawy
  position: number           // kolejność w obrębie dnia
  place_name: string
  place_id: string | null    // google place_id (jeśli znany)
  lat: number | null
  lon: number | null
  saved_place_id: string | null  // opcjonalne powiązanie z saved_places
  start_time: string | null  // "HH:MM" — planowana godzina startu
  duration_min: number | null // planowany czas zwiedzania (min)
  opening_hours: string[] | null // weekday_text (cache pod kartę dnia)
  tags: string[]
  note: string | null
  session_id: string | null  // kto dodał
  created_at: string
  updated_at: string
}

export type PlaceNote = {
  session_id: string
  user_name: string
  text: string
  created_at: string
}

// ——— PRZEWODNIK (opcjonalny dodatek z PDF Couple Away) ———
// Globalny, niezależny od pokoju. Patrz lib/featureFlags.ts (GUIDE_ENABLED).
export type GuidePlace = {
  id: string
  name: string
  category: string
  category_label: string | null
  lat: number | null
  lon: number | null
  description: string | null
  google_place_id: string | null
  google_rating: number | null
  google_total_ratings: number | null
  address: string | null
  source: string
  created_at: string
}

// ——— ASYSTENT AI (opcjonalny dodatek) ———
// Wspólny czat pokoju. Patrz lib/featureFlags.ts (ASSISTANT_ENABLED).
export type AssistantPlanStop = {
  guide_place_id: string | null
  name: string
  lat: number | null
  lon: number | null
  place_id: string | null
  note: string | null
  duration_min: number | null
}
export type AssistantPlan = {
  title: string | null
  stops: AssistantPlanStop[]
}
export type AssistantSource = { title: string; url: string }
export type AssistantMessage = {
  id: string
  room_id: string
  role: 'user' | 'assistant'
  content: string
  plan: AssistantPlan | null
  sources: AssistantSource[] | null
  author_name: string | null
  session_id: string | null
  created_at: string
}

// ——— INTELIGENCJA DNIA (Faza 3) ———
// Analiza AI (DeepSeek) + parking (Google Nearby + Brave) dla dnia planera.
// Liczona na żądanie, cache'owana i współdzielona przez ekipę (realtime).
export type DayBriefing = {
  summary: string
  timing: string
  feasibility: string
  stops: { name: string; tip: string; parking: string }[]
  weather: string | null
}

export type DayParking = {
  stop: string
  spots: { name: string; vicinity: string; distanceM: number | null }[]
}

export type DayInsightPayload = {
  briefing: DayBriefing | null
  parking: DayParking[]
  generatedAt: string
}

export type DayInsight = {
  id: string
  room_id: string
  day_index: number
  signature: string
  payload: DayInsightPayload
  created_at: string
  updated_at: string
}

// Baza dnia (Faza 3.4): miasto/okolica, promień i kategorie wyszukiwania.
// Współdzielone przez ekipę (realtime), per dzień.
export type DayMeta = {
  id: string
  room_id: string
  day_index: number
  city: string
  country: string
  radius: number
  categories: string[]
  created_at: string
  updated_at: string
}
