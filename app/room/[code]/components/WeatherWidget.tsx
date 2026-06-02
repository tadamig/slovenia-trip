'use client'

import { useState, useEffect } from 'react'
import { Room, UserPreference } from '@/lib/supabase'
import { Cloud, Sun, CloudRain, CloudSnow, Wind, Droplets } from 'lucide-react'

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
}

interface ClimateInfo {
  tempMax: number
  tempMin: number
  rainDays: number
  windowDays: number
  description: string
  yearsUsed: number
}

interface RegionForecast {
  name: string
  emoji: string
  lat?: number
  lon?: number
  days: DayForecast[]
  loading: boolean
  error?: string
  climate?: ClimateInfo | null
}

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

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString('pl-PL', { weekday: 'short', day: 'numeric', month: 'short' })
}

// Kod kraju ISO-2 → emoji flagi (regional indicator symbols). Fallback 📍.
function flagEmoji(cc?: string): string {
  if (!cc || cc.length !== 2) return '📍'
  const base = 0x1f1e6
  const chars = cc.toUpperCase().split('').map((c) => base + c.charCodeAt(0) - 65)
  if (chars.some((n) => n < 0x1f1e6 || n > 0x1f1ff)) return '📍'
  return String.fromCodePoint(...chars)
}

// Nazwa miasta → współrzędne (darmowy geokoder Open-Meteo, bez klucza).
// Preferuje wynik z kraju zgodnego z wyjazdem; w razie braku — pierwszy trafiony.
async function geocodeCity(
  city: string,
  country: string,
): Promise<{ lat: number; lon: number; label: string; emoji: string } | null> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
    city,
  )}&count=5&language=en&format=json`
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const data = await res.json()
    const results: any[] = data.results || []
    if (!results.length) return null
    const cc = country.trim().toLowerCase()
    const best =
      results.find((r) => (r.country || '').toLowerCase() === cc) || results[0]
    const label =
      best.admin1 && best.admin1 !== best.name ? `${best.name}, ${best.admin1}` : best.name
    return {
      lat: best.latitude,
      lon: best.longitude,
      label,
      emoji: flagEmoji(best.country_code),
    }
  } catch {
    return null
  }
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
  if (end > maxForecast) end.setTime(maxForecast.getTime())

  const fmt = (d: Date) => d.toISOString().split('T')[0]

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,weather_code&timezone=Europe%2FWarsaw&start_date=${fmt(start)}&end_date=${fmt(end)}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`API error ${res.status}`)
  const data = await res.json()

  return data.daily.time.map((date: string, i: number) => ({
    date,
    tempMax: Math.round(data.daily.temperature_2m_max[i]),
    tempMin: Math.round(data.daily.temperature_2m_min[i]),
    precipitation: data.daily.precipitation_sum[i] || 0,
    windSpeed: Math.round(data.daily.wind_speed_10m_max[i]),
    weatherCode: data.daily.weather_code[i],
  }))
}

// Dla wyjazdów >14 dni: realne dane historyczne dla terminu wyjazdu, uśrednione
// z ostatnich 3 lat (Open-Meteo Archive API, bez klucza). Dynamiczne dla KAŻDEGO
// miasta — zamiast zaszytych tabel klimatu.
async function fetchClimate(lat: number, lon: number, startDate?: string): Promise<ClimateInfo | null> {
  const tripStart = startDate ? new Date(startDate) : new Date()
  const tripEnd = new Date(tripStart)
  tripEnd.setDate(tripStart.getDate() + 9)
  const fmt = (d: Date) => d.toISOString().split('T')[0]

  const years = [1, 2, 3].map((back) => tripStart.getFullYear() - back)
  const calls = years.map((y) => {
    const s = new Date(tripStart)
    s.setFullYear(y)
    const e = new Date(tripEnd)
    e.setFullYear(y)
    const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${fmt(
      s,
    )}&end_date=${fmt(e)}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=Europe%2FWarsaw`
    return fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
  })

  const results = await Promise.all(calls)
  let maxSum = 0
  let minSum = 0
  let tempCnt = 0
  let rain = 0
  let dayCnt = 0
  let usedYears = 0

  for (const data of results) {
    const t = data?.daily
    if (!t?.time) continue
    usedYears++
    for (let i = 0; i < t.time.length; i++) {
      if (typeof t.temperature_2m_max[i] === 'number') {
        maxSum += t.temperature_2m_max[i]
        tempCnt++
      }
      if (typeof t.temperature_2m_min[i] === 'number') minSum += t.temperature_2m_min[i]
      if (typeof t.precipitation_sum[i] === 'number') {
        dayCnt++
        if (t.precipitation_sum[i] >= 1) rain++
      }
    }
  }

  if (tempCnt === 0 || usedYears === 0) return null

  const tempMax = Math.round(maxSum / tempCnt)
  const tempMin = Math.round(minSum / tempCnt)
  const windowDays = Math.max(1, Math.round(dayCnt / usedYears))
  const rainDays = dayCnt ? Math.round((rain / dayCnt) * windowDays) : 0

  const warm =
    tempMax >= 24 ? 'Ciepło' : tempMax >= 16 ? 'Przyjemnie' : tempMax >= 8 ? 'Chłodno' : 'Zimno'
  const wet =
    rainDays >= windowDays * 0.5 ? ', często deszcz' : rainDays > 0 ? ', okazjonalny deszcz' : ', sucho'

  return { tempMax, tempMin, rainDays, windowDays, description: `${warm}${wet}`, yearsUsed: usedYears }
}

function getPackingSuggestions(days: DayForecast[]): string[] {
  const suggestions: string[] = []
  if (days.length === 0) return []

  const hasRain = days.some((d) => d.precipitation > 3)
  const hasHighTemp = days.some((d) => d.tempMax > 28)
  const hasLowTemp = days.some((d) => d.tempMin < 12)
  const hasWind = days.some((d) => d.windSpeed > 25)
  const avgTemp = days.reduce((s, d) => s + d.tempMax, 0) / days.length

  if (hasRain) suggestions.push('🌧️ Zapowiadany deszcz — zabierz kurtkę przeciwdeszczową i wodoodporne buty')
  if (hasHighTemp) suggestions.push('☀️ Upały powyżej 28°C — krem z filtrem SPF50+, nakrycie głowy, dużo wody')
  if (hasLowTemp) suggestions.push('🥶 Chłodne poranki/wieczory — ciepła bluza lub polar na wieczorne ognisko')
  if (hasWind) suggestions.push('💨 Silny wiatr — może utrudniać SUP, sprawdź warunki przed wejściem na wodę')
  if (avgTemp > 22) suggestions.push('🏊 Temperatura sprzyja SUP i kąpielom — stroje kąpielowe na wierzch plecaka!')
  if (!hasRain) suggestions.push('🌤️ Prognoza bez deszczu — idealne warunki na trekking i SUP')

  return suggestions
}

function getClimateSuggestions(c: ClimateInfo): string[] {
  const suggestions: string[] = []
  if (c.tempMax > 28) suggestions.push('☀️ Zwykle upały — krem SPF50+, nakrycie głowy, dużo wody')
  if (c.tempMin < 12) suggestions.push('🥶 Chłodne wieczory bywają normą — ciepła bluza lub polar')
  if (c.rainDays >= c.windowDays * 0.4) suggestions.push('🌧️ W tym terminie często pada — kurtka przeciwdeszczowa')
  if (c.tempMax >= 22 && c.rainDays < c.windowDays * 0.4) suggestions.push('🏊 Zwykle dobre warunki na SUP i kąpiele')
  return suggestions
}

function ClimateView({ climate, startDate }: { climate: ClimateInfo; startDate: string | null }) {
  const month = startDate ? new Date(startDate).getMonth() : new Date().getMonth()
  const monthName = new Date(2024, month).toLocaleDateString('pl-PL', { month: 'long' })
  const daysUntil = startDate ? Math.ceil((new Date(startDate).getTime() - Date.now()) / 86400000) : null

  return (
    <div className="space-y-3">
      <div className="bg-stone-800/40 border border-stone-700/30 rounded-xl p-3 text-xs text-amber-400/80">
        📊 Prognoza niedostępna{daysUntil ? ` (wyjazd za ${daysUntil} dni)` : ''} — pokazuję typową pogodę dla terminu na podstawie ostatnich {climate.yearsUsed} lat
      </div>
      <div className="bg-stone-800/40 border border-stone-700/30 rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-stone-400 text-xs mb-1">{monthName} — typowo dla tego terminu</p>
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
            <p className="text-stone-600 text-xs">śr. maks. dzienna</p>
          </div>
          <div className="bg-stone-800/60 rounded-xl p-3 text-center">
            <p className="text-2xl mb-1">🌧️</p>
            <p className="text-stone-200 text-sm font-medium">~{climate.rainDays} z {climate.windowDays} dni</p>
            <p className="text-stone-600 text-xs">z opadami</p>
          </div>
          <div className="bg-stone-800/60 rounded-xl p-3 text-center">
            <p className="text-2xl mb-1">🌙</p>
            <p className="text-stone-200 text-sm font-medium">{climate.tempMin}°C</p>
            <p className="text-stone-600 text-xs">śr. min. nocna</p>
          </div>
        </div>

        <div className="text-xs text-stone-600 text-center">
          Dane historyczne (ostatnie {climate.yearsUsed} lata, ten sam termin) · Open-Meteo Archive API
        </div>
      </div>
    </div>
  )
}

export default function WeatherWidget({ room }: Props) {
  const [region, setRegion] = useState<RegionForecast | null>(null)
  const [suggestions, setSuggestions] = useState<string[]>([])

  const destCity = (room.end_city || room.start_city || '').trim()

  useEffect(() => {
    loadForecast()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.start_date, room.end_city, room.start_city, room.country])

  async function loadForecast() {
    const city = (room.end_city || room.start_city || '').trim()
    const country = (room.country || '').trim()
    setSuggestions([])

    if (!city) {
      setRegion(null)
      return
    }

    setRegion({ name: city, emoji: '📍', days: [], loading: true })

    const geo = await geocodeCity(city, country)
    if (!geo) {
      setRegion({ name: city, emoji: '📍', days: [], loading: false, error: 'Nie udało się ustalić lokalizacji miasta' })
      return
    }

    const daysUntil = room.start_date
      ? Math.ceil((new Date(room.start_date).getTime() - Date.now()) / 86400000)
      : 0
    const tooFarAhead = daysUntil > 14

    try {
      if (tooFarAhead) {
        const climate = await fetchClimate(geo.lat, geo.lon, room.start_date || undefined)
        setRegion({ name: geo.label, emoji: geo.emoji, lat: geo.lat, lon: geo.lon, days: [], loading: false, climate })
        setSuggestions(climate ? getClimateSuggestions(climate) : [])
      } else {
        const days = await fetchForecast(geo.lat, geo.lon, room.start_date || undefined)
        setRegion({ name: geo.label, emoji: geo.emoji, lat: geo.lat, lon: geo.lon, days, loading: false })
        setSuggestions(getPackingSuggestions(days))
      }
    } catch {
      setRegion({ name: geo.label, emoji: geo.emoji, days: [], loading: false, error: 'Błąd pobierania danych' })
    }
  }

  return (
    <div className="px-4 py-5 max-w-lg mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold text-stone-100">Pogoda w celu podróży</h2>
        {room.start_date && (
          <span className="text-xs text-stone-500 bg-stone-800 px-2.5 py-1 rounded-full">
            od {new Date(room.start_date).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' })}
          </span>
        )}
      </div>

      {!destCity ? (
        <div className="bg-stone-800/40 border border-stone-700/40 rounded-xl p-3 text-stone-500 text-xs">
          📍 Podaj cel wyjazdu w preferencjach, żeby zobaczyć pogodę dla właściwego miasta.
        </div>
      ) : (
        <>
          {/* Wybrane miasto docelowe */}
          {region && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-water-600/20 border border-water-500/50 text-water-300 text-sm font-medium w-fit">
              <span>{region.emoji}</span>
              <span>{region.name}</span>
            </div>
          )}

          {(() => {
            if (!room.start_date) return (
              <div className="bg-stone-800/40 border border-stone-700/40 rounded-xl p-3 text-stone-500 text-xs">
                📅 Podaj datę wyjazdu w preferencjach żeby zobaczyć prognozę na właściwy termin.
              </div>
            )
            const daysUntil = Math.ceil((new Date(room.start_date).getTime() - Date.now()) / 86400000)
            if (daysUntil > 14) return null
            return null
          })()}

          {/* Forecast strip */}
          {!region || region.loading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-16 bg-stone-800/40 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : region.error ? (
            <div className="text-center py-8 text-stone-600 text-sm">{region.error}</div>
          ) : region.climate ? (
            <ClimateView climate={region.climate} startDate={room.start_date} />
          ) : region.days.length === 0 ? (
            <div className="text-center py-8 text-stone-600 text-sm">Brak danych pogodowych dla tego terminu</div>
          ) : (
            <div className="space-y-2">
              {region.days.map((day, i) => (
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
        </>
      )}
    </div>
  )
}
