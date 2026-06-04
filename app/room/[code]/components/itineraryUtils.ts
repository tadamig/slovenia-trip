// Czyste funkcje pomocnicze planera dni: liczba dni, daty, godziny otwarcia,
// check wykonalności i pogoda dnia (Open-Meteo). Bez zależności od React.

import { Room } from '@/lib/supabase'

const EN_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// Liczba dni wyprawy: z dat pokoju (start..end włącznie), a jeśli ich brak —
// tyle, ile wynika z istniejących przystanków (min. domyślna wartość).
export function tripDayCount(room: Room, maxDayIndexUsed: number, extraDays: number): number {
  let base = 1
  if (room.start_date && room.end_date) {
    const s = new Date(room.start_date)
    const e = new Date(room.end_date)
    const diff = Math.round((e.getTime() - s.getTime()) / 86400000) + 1
    if (diff > 0) base = diff
  } else {
    base = 5 // sensowny default, gdy daty nie są ustawione
  }
  return Math.max(base, maxDayIndexUsed + 1, 1) + Math.max(0, extraDays)
}

// Data konkretnego dnia (0-based) na podstawie start_date pokoju.
export function dateForDay(startDate: string | null, dayIndex: number): Date | null {
  if (!startDate) return null
  const d = new Date(startDate)
  if (isNaN(d.getTime())) return null
  d.setDate(d.getDate() + dayIndex)
  return d
}

export function formatDayDate(date: Date | null): string {
  if (!date) return ''
  return date.toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' })
}

// Linia godzin otwarcia z weekday_text dla danej daty (po nazwie dnia tygodnia,
// niezależnie od kolejności tablicy). Zwraca surowy tekst Google albo null.
export function openingLineForDate(weekdayText: string[] | null | undefined, date: Date | null): string | null {
  if (!weekdayText || !weekdayText.length || !date) return null
  const dayName = EN_WEEKDAYS[date.getDay()]
  const line = weekdayText.find((l) => l.trim().toLowerCase().startsWith(dayName.toLowerCase()))
  if (!line) return null
  // Usuń prefiks "Monday: "
  const colon = line.indexOf(':')
  return colon >= 0 ? line.slice(colon + 1).trim() : line.trim()
}

// "9:00 AM" / "21:30" → minuty od północy. null gdy nie da się sparsować.
function parseClock(raw: string): number | null {
  const m = raw.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i)
  if (!m) return null
  let h = parseInt(m[1], 10)
  const min = m[2] ? parseInt(m[2], 10) : 0
  const mer = (m[3] || '').toLowerCase()
  if (mer === 'pm' && h < 12) h += 12
  if (mer === 'am' && h === 12) h = 0
  if (h > 24 || min > 59) return null
  return h * 60 + min
}

export type OpenState = 'open' | 'closed' | 'unknown'

// Czy miejsce jest otwarte o danej porze (HH:MM) w dniu opisanym linią godzin.
export function isOpenAt(openingLine: string | null, startTime: string | null): OpenState {
  if (!openingLine) return 'unknown'
  const low = openingLine.toLowerCase()
  if (low.includes('closed') || low.includes('zamkn')) return 'closed'
  if (low.includes('24 hour') || low.includes('open 24') || low.includes('całodob')) return 'open'
  if (!startTime) return 'unknown'
  const target = parseClock(startTime)
  if (target == null) return 'unknown'
  // Rozbij na zakresy po przecinku, każdy zakres po myślniku (– lub -).
  const ranges = openingLine.split(',')
  for (const r of ranges) {
    const parts = r.split(/[–-]/)
    if (parts.length < 2) continue
    const from = parseClock(parts[0])
    const to = parseClock(parts[1])
    if (from == null || to == null) continue
    if (to > from ? target >= from && target <= to : target >= from || target <= to) return 'open'
  }
  return 'closed'
}

// ——— WYKONALNOŚĆ DNIA ———
export const DAY_BUDGET_MIN = 600 // ~10 h sensownego dnia w terenie

export type Feasibility = {
  driveMin: number       // łączny czas przejazdów (min)
  visitMin: number       // łączny czas zwiedzania (min)
  totalMin: number
  overBudget: boolean
  closedCount: number    // ile przystanków wypada przy zamkniętym miejscu
}

export function summarizeFeasibility(driveMin: number, visitMin: number, closedCount: number): Feasibility {
  const totalMin = driveMin + visitMin
  return { driveMin, visitMin, totalMin, overBudget: totalMin > DAY_BUDGET_MIN, closedCount }
}

export function formatDuration(min: number): string {
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  if (h && m) return `${h}h ${m}min`
  if (h) return `${h}h`
  return `${m}min`
}

// ——— POGODA DNIA (Open-Meteo, bez klucza) ———
export type DayWeather = {
  tempMax: number
  tempMin: number
  precipitation: number
  weatherCode: number
}

export async function fetchDayWeather(lat: number, lon: number, date: Date): Promise<DayWeather | null> {
  const now = new Date()
  const maxForecast = new Date()
  maxForecast.setDate(now.getDate() + 14)
  // Poza zakresem prognozy — nie pokazujemy nic (klimat zostaje w zakładce Pogoda).
  if (date > maxForecast || date < new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)) return null
  const fmt = (d: Date) => d.toISOString().split('T')[0]
  const day = fmt(date)
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code&timezone=Europe%2FWarsaw&start_date=${day}&end_date=${day}`
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const data = await res.json()
    const t = data.daily
    if (!t?.time?.length) return null
    return {
      tempMax: Math.round(t.temperature_2m_max[0]),
      tempMin: Math.round(t.temperature_2m_min[0]),
      precipitation: t.precipitation_sum[0] || 0,
      weatherCode: t.weather_code[0],
    }
  } catch {
    return null
  }
}

export function weatherEmoji(code: number): string {
  if (code === 0) return '☀️'
  if (code <= 2) return '🌤️'
  if (code <= 3) return '☁️'
  if (code <= 49) return '🌫️'
  if (code <= 59) return '🌦️'
  if (code <= 67) return '🌧️'
  if (code <= 77) return '🌨️'
  if (code <= 82) return '🌧️'
  return '⛈️'
}

export function weatherHint(w: DayWeather): string | null {
  if (w.precipitation >= 3) return '🌧️ Zapowiada się deszcz — rozważ plan w pomieszczeniu lub elastyczność.'
  if (w.tempMax >= 30) return '🥵 Upał — woda, cień, krem; cięższe trasy lepiej rano.'
  if (w.tempMax <= 8) return '🧥 Chłodno — ciepłe warstwy.'
  return null
}
