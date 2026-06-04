-- ============================================
-- Slovenia Trip Planner — Supabase Schema
-- Wklej całość w: Supabase → SQL Editor → Run
-- ============================================

-- 1. ROOMS — pokoje z kodem dostępu
CREATE TABLE IF NOT EXISTS rooms (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  start_city TEXT DEFAULT '',
  end_city TEXT DEFAULT 'Ljubljana',
  start_date DATE,
  trip_name TEXT DEFAULT 'Wyprawa do Słowenii'
);

-- 2. USER PREFERENCES — preferencje każdego użytkownika
CREATE TABLE IF NOT EXISTS user_preferences (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  user_name TEXT DEFAULT 'Nieznajomy',
  activities JSONB DEFAULT '[]',
  intensity TEXT DEFAULT 'balanced',
  accommodation TEXT DEFAULT 'van_plus',
  food JSONB DEFAULT '[]',
  completed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(room_id, session_id)
);

-- 3. PACKING ITEMS — lista rzeczy do zabrania
CREATE TABLE IF NOT EXISTS packing_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT 'inne',
  name TEXT NOT NULL,
  checked BOOLEAN DEFAULT FALSE,
  added_by TEXT DEFAULT 'nieznany',
  added_by_session TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. SAVED PLACES — zapisane miejsca z głosami i notatkami
CREATE TABLE IF NOT EXISTS saved_places (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
  place_name TEXT NOT NULL,
  place_data JSONB NOT NULL DEFAULT '{}',
  votes INTEGER DEFAULT 0,
  voters JSONB DEFAULT '[]',
  notes JSONB DEFAULT '[]',
  tags JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. ITINERARY ITEMS — planer dni (przystanki przypisane do dnia)
CREATE TABLE IF NOT EXISTS itinerary_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
  day_index INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  place_name TEXT NOT NULL,
  place_id TEXT,
  lat DOUBLE PRECISION,
  lon DOUBLE PRECISION,
  saved_place_id UUID REFERENCES saved_places(id) ON DELETE SET NULL,
  start_time TEXT,
  duration_min INTEGER,
  opening_hours JSONB,
  tags JSONB DEFAULT '[]',
  note TEXT,
  session_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS itinerary_items_room_day_idx ON itinerary_items (room_id, day_index, position);

-- 6. DAY INSIGHTS — analiza AI dnia (brief + parking), cache współdzielony (Faza 3)
CREATE TABLE IF NOT EXISTS day_insights (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
  day_index INTEGER NOT NULL DEFAULT 0,
  signature TEXT NOT NULL DEFAULT '',     -- podpis składu dnia (gdy się zmieni → przelicz)
  payload JSONB NOT NULL DEFAULT '{}',    -- { briefing, parking, generatedAt }
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(room_id, day_index)
);

-- 7. DAY META — baza dnia (miasto/okolica, promień, kategorie) — Faza 3.4
CREATE TABLE IF NOT EXISTS day_meta (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
  day_index INTEGER NOT NULL DEFAULT 0,
  city TEXT DEFAULT '',
  country TEXT DEFAULT '',
  radius INTEGER DEFAULT 40,
  categories JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(room_id, day_index)
);

-- ============================================
-- REALTIME — włącz dla wszystkich tabel
-- ============================================
ALTER PUBLICATION supabase_realtime ADD TABLE rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE user_preferences;
ALTER PUBLICATION supabase_realtime ADD TABLE packing_items;
ALTER PUBLICATION supabase_realtime ADD TABLE saved_places;
ALTER PUBLICATION supabase_realtime ADD TABLE itinerary_items;
ALTER PUBLICATION supabase_realtime ADD TABLE day_insights;
ALTER PUBLICATION supabase_realtime ADD TABLE day_meta;

-- ============================================
-- ROW LEVEL SECURITY — dostęp przez room_id
-- (wyłączamy RLS dla MVP — dostęp przez kod)
-- ============================================
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE packing_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_places ENABLE ROW LEVEL SECURITY;

-- Polityki: każdy z anon key może czytać i pisać
CREATE POLICY "public_access_rooms" ON rooms FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public_access_prefs" ON user_preferences FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public_access_packing" ON packing_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public_access_places" ON saved_places FOR ALL USING (true) WITH CHECK (true);
ALTER TABLE itinerary_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_access_itinerary" ON itinerary_items FOR ALL USING (true) WITH CHECK (true);
ALTER TABLE day_insights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_access_day_insights" ON day_insights FOR ALL USING (true) WITH CHECK (true);
ALTER TABLE day_meta ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_access_day_meta" ON day_meta FOR ALL USING (true) WITH CHECK (true);

-- ============================================
-- FUNKCJA — generowanie unikalnego kodu 6-znakowego
-- ============================================
CREATE OR REPLACE FUNCTION generate_room_code()
RETURNS TEXT AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result TEXT := '';
  i INT;
BEGIN
  FOR i IN 1..6 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql;
