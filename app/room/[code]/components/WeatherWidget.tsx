'use client'

import { useState, useEffect } from 'react'
import { Room, UserPreference } from '@/lib/supabase'
import { Cloud, Sun, CloudRain, CloudSnow, Wind, Droplets, Thermometer, MapPin } from 'lucide-react'

interface Props {
  room: Room
  myPrefs: UserPreference
}

interface DayForecast {
  date: string
  tempMax: number
  tempMin: number
  precipitation: number
  windSpeed: number
  weatherCode: number
  region: string
}

interface RegionForecast {
  name: string
  emoji: string
  lat: number
  lon: number
  days: DayForecast[]
  loading: boolean
  error?: string
  climate?: boolean
}

const REGIONS = [
  { name: 'Budapeszt', emoji: '🇭🇺', lat: 47.4979, lon: 19.0402 },
  { name: 'Bled, Słowenia', emoji: '🇸🇮', lat: 46.3683, lon: 14.1146 },
  { name: 'Ljubljana', emoji: '🏙️', lat: 46.0569, lon: 14.5058 },
]

function getWeatherIcon(code: number, size = 'w-6 h-6') {
  if (code === 0) return <Sun className={`${size} text-yellow-400`} />
  if (code <= 3) return <Cloud className={`${size} text-stone-400`} />
  if (code <= 67) return <CloudRain className={`${size} text-water-400`} />
  if (code <= 77) return <CloudSnow className={`${size} text-blue-300`} />
  return <CloudRain className={`${size} text-water-500`} />
}

function getWeatherLabel(code: number): string {
  if (code === 0) return 'Słonecznie'
  if (code <= 2) return 'Częściowe zachmurzenie'
  if (code <= 3) return 'Zachmurzenie'
  if (code <= 49) return 'Mgła'
  if (code <= 59) return 'Mżawka'
  if (code <= 67) return 'Deszcz'
  if (code <= 77) return 'Śnieg'
  if (code <= 82) return 'Przelotny deszcz'
  return 'Burza'
}

function getPackingSuggestions(forecasts: RegionForecast[]): string[] {
  const suggestions: string[] = []
  const allDays = forecasts.flatMap(r => r.days)
  if (allDays.length === 0) return []

  const hasRain = allDays.some(d => d.precipitation > 3)
  const hasHighTemp = allDays.some(d => d.tempMax > 28)
  const hasLowTemp = allDays.some(d => d.tempMin < 12)
  const hasWind = allDays.some(d => d.windSpeed > 25)
  const avgTemp = allDays.reduce((s, d) => s + d.tempMax, 0) / allDays.length

  if (hasRain) suggestions.push('🌧️ Zapowiadany deszcz — zabierz kurtkę przeciwdeszczową i wodoodporne buty')
  if (hasHighTemp) suggestions.push('☀️ Upały powyżej 28°C — krem z filtrem SPF50+, nakrycie głowy, dużo wody')
  if (hasLowTemp) suggestions.push('🥶 Chłodne poranki/wieczory — ciepła bluza lub polar na wieczorne ognisko')
  if (hasWind) suggestions.push('💨 Silny wiatr — może utrudniać SUP, sprawdź warunki przed wejściem na wodę')
  if (avgTemp > 22) suggestions.push('🏊 Temperatura sprzyja SUP i kąpielom — stroje kąpielowe na wierzch plecaka!')
  if (!hasRain) suggestions.push('🌤️ Prognoza bez deszczu — idealne warunki na trekking i SUP')

  return suggestions
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString('pl-PL', { weekday: 'short', day: 'numeric', month: 'short' })
}


// Historyczne dane klimatyczne (średnie wieloletnie) dla każdego regionu i miesiąca
const CLIMATE_DATA: Record<string, Record<number, { tempMax: number; tempMin: number; rainDays: number; description: string }>> = {
  'Budapeszt 🇭🇺': {
    1: { tempMax: 4, tempMin: -2, rainDays: 10, description: 'Zimno, możliwy śnieg' },
    2: { tempMax: 7, tempMin: 0, rainDays: 9, description: 'Zimno, zmienne' },
    3: { tempMax: 13, tempMin: 4, rainDays: 9, description: 'Chłodna wiosna' },
    4: { tempMax: 19, tempMin: 9, rainDays: 10, description: 'Wiosna, deszczowo' },
    5: { tempMax: 24, tempMin: 13, rainDays: 11, description: 'Ciepło, burze' },
    6: { tempMax: 27, tempMin: 17, rainDays: 11, description: 'Gorąco, letnie burze' },
    7: { tempMax: 30, tempMin: 19, rainDays: 8, description: 'Upały, słonecznie' },
    8: { tempMax: 30, tempMin: 19, rainDays: 8, description: 'Upały, słonecznie' },
    9: { tempMax: 24, tempMin: 14, rainDays: 8, description: 'Przyjemne, słoneczne' },
    10: { tempMax: 17, tempMin: 8, rainDays: 9, description: 'Chłodna jesień' },
    11: { tempMax: 9, tempMin: 3, rainDays: 11, description: 'Zimno, deszczowo' },
    12: { tempMax: 4, tempMin: -1, rainDays: 11, description: 'Zimno, możliwy śnieg' },
  },
  'Bled, Słowenia': {
    1: { tempMax: 2, tempMin: -5, rainDays: 9, description: 'Zimno, śnieg w górach' },
    2: { tempMax: 5, tempMin: -4, rainDays: 8, description: 'Zimno, zmienne' },
    3: { tempMax: 10, tempMin: 0, rainDays: 10, description: 'Wczesna wiosna' },
    4: { tempMax: 15, tempMin: 4, rainDays: 12, description: 'Deszczowa wiosna' },
    5: { tempMax: 20, tempMin: 9, rainDays: 13, description: 'Ciepło, często deszcz' },
    6: { tempMax: 23, tempMin: 13, rainDays: 13, description: 'Ciepło, SUP możliwy' },
    7: { tempMax: 26, tempMin: 15, rainDays: 11, description: 'Idealne na SUP i trekking' },
    8: { tempMax: 26, tempMin: 15, rainDays: 11, description: 'Idealne na SUP i trekking' },
    9: { tempMax: 21, tempMin: 10, rainDays: 11, description: 'Przyjemne, mniej tłumów' },
    10: { tempMax: 14, tempMin: 5, rainDays: 12, description: 'Chłodna jesień' },
    11: { tempMax: 7, tempMin: 1, rainDays: 12, description: 'Zimno, deszczowo' },
    12: { tempMax: 2, tempMin: -3, rainDays: 10, description: 'Zimno, śnieg możliwy' },
  },
  'Ljubljana': {
    1: { tempMax: 3, tempMin: -3, rainDays: 8, description: 'Zimno, możliwy śnieg' },
    2: { tempMax: 7, tempMin: -1, rainDays: 8, description: 'Zimno, zmienne' },
    3: { tempMax: 12, tempMin: 2, rainDays: 10, description: 'Wczesna wiosna' },
    4: { tempMax: 17, tempMin: 6, rainDays: 12, description: 'Deszczowa wiosna' },
    5: { tempMax: 22, tempMin: 11, rainDays: 13, description: 'Ciepło, przelotny deszcz' },
    6: { tempMax: 25, tempMin: 14, rainDays: 13, description: 'Ciepło, letnie burze' },
    7: { tempMax: 28, tempMin: 16, rainDays: 10, description: 'Gorąco, słonecznie' },
    8: { tempMax: 28, tempMin: 16, rainDays: 10, description: 'Gorąco, słonecznie' },
    9: { tempMax: 22, tempMin: 11, rainDays: 10, description: 'Przyjemne, złota jesień' },
    10: { tempMax: 15, tempMin: 6, rainDays: 11, description: 'Chłodna jesień' },
    11: { tempMax: 8, tempMin: 2, rainDays: 12, description: 'Zimno, deszczowo' },
    12: { tempMax: 3, tempMin: -2, rainDays: 9, description: 'Zimno' },
  },
}

async function fetchForecast(lat: number, lon: number, startDate?: string): Promise<DayForecast[]> {
  const now = new Date()
  const maxForecast = new Date()
  maxForecast.setDate(now.getDate() + 14)

  // Jeśli data wyjazdu jest poza zakresem API (>14 dni), pokaż aktualną pogodę
  let start = new Date()
  if (startDate) {
    const requested = new Date(startDate)
    start = requested <= maxForecast ? requested : now
  }

  const end = new Date(start)
  end.setDate(start.getDate() + 9)
  // end nie może przekroczyć 16 dni od dziś
  if (end > maxForecast) end.setTime(maxForecast.getTime())

  const fmt = (d: Date) => d.toISOString().split('T')[0]

  const params = new URLSearchParams({ lat: String(lat), lon: String(lon), start_date: fmt(start), end_date: fmt(end) })
  const res = await fetch(`/api/weather?${params}`)
  if (!res.ok) throw new Error(`API error ${res.status}`)
  const data = await res.json()

  return data.daily.time.map((date: string, i: number) => ({
    date,
    tempMax: Math.round(data.daily.temperature_2m_max[i]),
    tempMin: Math.round(data.daily.temperature_2m_min[i]),
    precipitation: data.daily.precipitation_sum[i] || 0,
    windSpeed: Math.round(data.daily.wind_speed_10m_max[i]),
    weatherCode: data.daily.weather_code[i],
    region: '',
  }))
}


function ClimateView({ regionName, startDate }: { regionName: string; startDate: string | null }) {
  const month = startDate ? new Date(startDate).getMonth() + 1 : new Date().getMonth() + 1
  const climate = CLIMATE_DATA[regionName]?.[month]
  const monthName = new Date(2024, month - 1).toLocaleDateString('pl-PL', { month: 'long' })
  const daysUntil = startDate ? Math.ceil((new Date(startDate).getTime() - Date.now()) / 86400000) : null

  if (!climate) return (
    <div className="text-stone-600 text-sm text-center py-6">Brak danych klimatycznych</div>
  )

  return (
    <div className="space-y-3">
      <div className="bg-stone-800/40 border border-stone-700/30 rounded-xl p-3 text-xs text-amber-400/80">
        📊 Prognoza niedostępna{daysUntil ? ` (wyjazd za ${daysUntil} dni)` : ''} — pokazuję dane historyczne dla <strong>{monthName}</strong>
      </div>
      <div className="bg-stone-800/40 border border-stone-700/30 rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-stone-400 text-xs mb-1">{monthName} — historyczne średnie</p>
            <p className="text-stone-200 text-sm">{climate.description}</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-stone-100">{climate.tempMax}°</p>
            <p className="text-stone-500 text-sm">{climate.tempMin}° min</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="bg-stone-800/60 rounded-xl p-3 text-center">
            <p className="text-2xl mb-1">☀️</p>
            <p className="text-stone-200 text-sm font-medium">{climate.tempMax}°C</p>
            <p className="text-stone-600 text-xs">maks. dzienna</p>
          </div>
          <div className="bg-stone-800/60 rounded-xl p-3 text-center">
            <p className="text-2xl mb-1">🌧️</p>
            <p className="text-stone-200 text-sm font-medium">{climate.rainDays} dni</p>
            <p className="text-stone-600 text-xs">deszczowych</p>
          </div>
          <div className="bg-stone-800/60 rounded-xl p-3 text-center">
            <p className="text-2xl mb-1">🌙</p>
            <p className="text-stone-200 text-sm font-medium">{climate.tempMin}°C</p>
            <p className="text-stone-600 text-xs">min. nocna</p>
          </div>
        </div>

        <div className="text-xs text-stone-600 text-center">
          Dane historyczne 2000–2024 · Open-Meteo Climate API
        </div>
      </div>
    </div>
  )
}

export default function WeatherWidget({ room, myPrefs }: Props) {
  const [forecasts, setForecasts] = useState<RegionForecast[]>(
    REGIONS.map(r => ({ ...r, days: [], loading: true }))
  )
  const [selectedRegion, setSelectedRegion] = useState(0)
  const [suggestions, setSuggestions] = useState<string[]>([])

  useEffect(() => {
    loadAllForecasts()
  }, [room.start_date])

  async function loadAllForecasts() {
    const now = new Date()
    const daysUntil = room.start_date
      ? Math.ceil((new Date(room.start_date).getTime() - now.getTime()) / 86400000)
      : 0
    const tooFarAhead = daysUntil > 14

    const updated = await Promise.all(
      REGIONS.map(async (region) => {
        try {
          if (tooFarAhead) {
            // Pokaż dane klimatyczne zamiast prognozy
            return { ...region, days: [], loading: false, climate: true }
          }
          const days = await fetchForecast(region.lat, region.lon, room.start_date || undefined)
          return { ...region, days, loading: false }
        } catch {
          return { ...region, days: [], loading: false, error: 'Błąd pobierania danych' }
        }
      })
    )
    setForecasts(updated as any)
    setSuggestions(getPackingSuggestions(updated))
  }

  const current = forecasts[selectedRegion]

  return (
    <div className="px-4 py-5 max-w-lg mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold text-stone-100">Pogoda na trasie</h2>
        {room.start_date && (
          <span className="text-xs text-stone-500 bg-stone-800 px-2.5 py-1 rounded-full">
            od {new Date(room.start_date).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' })}
          </span>
        )}
      </div>

      {(() => {
        if (!room.start_date) return (
          <div className="bg-stone-800/40 border border-stone-700/40 rounded-xl p-3 text-stone-500 text-xs">
            📅 Podaj datę wyjazdu w preferencjach żeby zobaczyć prognozę na właściwy termin.
          </div>
        )
        const daysUntil = Math.ceil((new Date(room.start_date).getTime() - Date.now()) / 86400000)
        if (daysUntil > 14) return (
          <div className="bg-sand-900/20 border border-sand-700/30 rounded-xl p-3 text-sand-400 text-xs">
            📅 Wyjazd za {daysUntil} dni — prognoza dostępna na max 14 dni. Pokazuję aktualną pogodę na trasie.
          </div>
        )
        return null
      })()}

      {/* Region tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
        {forecasts.map((region, i) => (
          <button
            key={region.name}
            onClick={() => setSelectedRegion(i)}
            className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-all ${
              selectedRegion === i
                ? 'bg-water-600/20 border border-water-500/50 text-water-300'
                : 'bg-stone-800/60 border border-stone-700/50 text-stone-500 hover:text-stone-300'
            }`}
          >
            <span>{region.emoji}</span>
            <span>{region.name}</span>
          </button>
        ))}
      </div>

      {/* Forecast strip */}
      {current.loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 bg-stone-800/40 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : current.error ? (
        <div className="text-center py-8 text-stone-600 text-sm">{current.error}</div>
      ) : current.climate ? (
        <ClimateView regionName={current.name} startDate={room.start_date} />
      ) : (
        <div className="space-y-2">
          {current.days.map((day, i) => (
            <div
              key={day.date}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all ${
                i === 0
                  ? 'bg-water-900/20 border-water-700/30'
                  : 'bg-stone-800/40 border-stone-700/30'
              }`}
            >
              <div className="w-16 flex-shrink-0">
                <p className="text-xs text-stone-400 font-medium">{formatDate(day.date)}</p>
                {i === 0 && <p className="text-xs text-water-400">Dziś</p>}
              </div>

              <div className="flex-shrink-0">
                {getWeatherIcon(day.weatherCode)}
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-xs text-stone-400 truncate">{getWeatherLabel(day.weatherCode)}</p>
                {day.precipitation > 0.5 && (
                  <p className="text-xs text-water-400 flex items-center gap-1">
                    <Droplets className="w-3 h-3" /> {day.precipitation.toFixed(1)} mm
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                <div className="flex items-center gap-1">
                  <Wind className="w-3 h-3 text-stone-600" />
                  <span className="text-xs text-stone-500">{day.windSpeed}</span>
                </div>
                <div className="text-right">
                  <span className="text-sm font-semibold text-stone-200">{day.tempMax}°</span>
                  <span className="text-xs text-stone-600 ml-1">{day.tempMin}°</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Packing suggestions */}
      {suggestions.length > 0 && (
        <div className="bg-forest-900/20 border border-forest-700/30 rounded-2xl p-4 space-y-2">
          <p className="text-forest-400 text-xs font-semibold uppercase tracking-wider mb-3">
            💡 Sugestie pakowania na podstawie pogody
          </p>
          {suggestions.map((s, i) => (
            <p key={i} className="text-stone-300 text-xs leading-relaxed">{s}</p>
          ))}
        </div>
      )}
    </div>
  )
}
