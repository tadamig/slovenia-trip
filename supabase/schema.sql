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

-- ============================================
-- REALTIME — włącz dla wszystkich tabel
-- ============================================
ALTER PUBLICATION supabase_realtime ADD TABLE rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE user_preferences;
ALTER PUBLICATION supabase_realtime ADD TABLE packing_items;
ALTER PUBLICATION supabase_realtime ADD TABLE saved_places;

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
