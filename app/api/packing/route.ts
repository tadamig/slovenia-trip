import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 60

// ——— Słowniki etykiet (spójne z DialogFlow) ———
const ACTIVITY_LABELS: Record<string, string> = {
  sup: 'SUP / pływanie',
  trekking: 'trekking',
  food: 'lokalne jedzenie',
  sunset: 'zachody słońca',
  van: 'nocleg w vanie',
  sightseeing: 'zwiedzanie miast',
  cycling: 'rower',
  relax: 'relaks / slow travel',
  photo: 'fotografia',
  nightlife: 'bary / życie nocne',
  markets: 'lokalne targi',
  petfriendly: 'podróż ze zwierzęciem',
}

const ACCOMMODATION_LABELS: Record<string, string> = {
  tent: 'namiot / camping',
  van: 'van / kamper',
  airbnb: 'Airbnb / domki',
  hotel: 'hotel / hostel',
}

const GENDER_LABELS: Record<string, string> = {
  female: 'kobieta',
  male: 'mężczyzna',
  other: 'inne',
  unspecified: 'nieokreślona',
}

const TOGGLE_LABELS: Record<string, string> = {
  ownMeds: 'bierze własne leki na receptę',
  cosmetics: 'rozbudowana kosmetyczka / pielęgnacja',
  contactLenses: 'soczewki kontaktowe / okulary',
  electronics: 'sprzęt elektroniczny (laptop, tablet)',
  makeup: 'makijaż',
}

const ALLOWED_CATEGORIES = ['ubrania', 'kosmetyki', 'elektronika', 'sprzet', 'jedzenie', 'nocleg', 'dokumenty', 'inne']

type WeatherContext = {
  summary: string
  tempMax: number | null
  tempMin: number | null
  rainDays: number | null
  source: 'forecast' | 'climate' | 'none'
}

// ——— Pogoda serwerowo (Open-Meteo, bez klucza) ———
async function geocode(city: string, country: string): Promise<{ lat: number; lon: number } | null> {
  if (!city) return null
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=5&language=en&format=json`
    const res = await fetch(url, { next: { revalidate: 86400 } })
    if (!res.ok) return null
    const data = await res.json()
    const results: Array<{ latitude: number; longitude: number; country?: string }> = data?.results || []
    if (results.length === 0) return null
    const wanted = (country || '').trim().toLowerCase()
    const match = wanted
      ? results.find((r) => (r.country || '').toLowerCase() === wanted) || results[0]
      : results[0]
    return { lat: match.latitude, lon: match.longitude }
  } catch {
    return null
  }
}

function daysBetween(start?: string | null, end?: string | null): number {
  if (!start) return 4
  const s = new Date(start)
  const e = end ? new Date(end) : s
  const diff = Math.round((e.getTime() - s.getTime()) / 86400000) + 1
  return Math.max(1, Math.min(diff, 60))
}

function weatherCtxNone(days: number): WeatherContext {
  return {
    summary: `Brak danych pogodowych — zakładam typową pogodę. Wyjazd na ${days} dni.`,
    tempMax: null,
    tempMin: null,
    rainDays: null,
    source: 'none',
  }
}

async function buildWeather(city: string, country: string, startDate?: string | null, endDate?: string | null): Promise<WeatherContext> {
  const days = daysBetween(startDate, endDate)
  const coords = await geocode(city, country)
  if (!coords) return weatherCtxNone(days)

  const now = new Date()
  const start = startDate ? new Date(startDate) : now
  const daysUntil = Math.round((start.getTime() - now.getTime()) / 86400000)

  try {
    if (daysUntil <= 14) {
      // Prognoza krótkoterminowa
      const maxDate = new Date()
      maxDate.setDate(now.getDate() + 14)
      const fmt = (d: Date) => d.toISOString().split('T')[0]
      let s = startDate && new Date(startDate) > maxDate ? fmt(now) : (startDate || fmt(now))
      let e = endDate && new Date(endDate) > maxDate ? fmt(maxDate) : (endDate || s)
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto&start_date=${s}&end_date=${e}`
      const res = await fetch(url, { next: { revalidate: 3600 } })
      if (!res.ok) return weatherCtxNone(days)
      const data = await res.json()
      const tmax: number[] = data?.daily?.temperature_2m_max || []
      const tmin: number[] = data?.daily?.temperature_2m_min || []
      const prec: number[] = data?.daily?.precipitation_sum || []
      if (tmax.length === 0) return weatherCtxNone(days)
      const max = Math.round(Math.max(...tmax))
      const min = Math.round(Math.min(...tmin))
      const rainDays = prec.filter((p) => p >= 1).length
      return {
        summary: `Prognoza dla ${city}: ${min}–${max}°C, dni z deszczem: ${rainDays}/${tmax.length}. Wyjazd na ${days} dni.`,
        tempMax: max,
        tempMin: min,
        rainDays,
        source: 'forecast',
      }
    } else {
      // Klimat historyczny (średnia z 3 ostatnich lat dla tego samego okna dat)
      const fmt = (d: Date) => d.toISOString().split('T')[0]
      const s = startDate ? new Date(startDate) : now
      const e = endDate ? new Date(endDate) : s
      const calls = [1, 2, 3].map((yAgo) => {
        const ys = new Date(s); ys.setFullYear(s.getFullYear() - yAgo)
        const ye = new Date(e); ye.setFullYear(e.getFullYear() - yAgo)
        const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${coords.lat}&longitude=${coords.lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto&start_date=${fmt(ys)}&end_date=${fmt(ye)}`
        return fetch(url, { next: { revalidate: 86400 } }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
      })
      const results = await Promise.all(calls)
      const allMax: number[] = []
      const allMin: number[] = []
      let rainCount = 0
      let dayCount = 0
      for (const r of results) {
        const tmax: number[] = r?.daily?.temperature_2m_max || []
        const tmin: number[] = r?.daily?.temperature_2m_min || []
        const prec: number[] = r?.daily?.precipitation_sum || []
        tmax.forEach((v) => typeof v === 'number' && allMax.push(v))
        tmin.forEach((v) => typeof v === 'number' && allMin.push(v))
        prec.forEach((p) => { if (typeof p === 'number') { dayCount++; if (p >= 1) rainCount++ } })
      }
      if (allMax.length === 0) return weatherCtxNone(days)
      const avgMax = Math.round(allMax.reduce((a, b) => a + b, 0) / allMax.length)
      const avgMin = Math.round(allMin.reduce((a, b) => a + b, 0) / allMin.length)
      const rainPct = dayCount ? Math.round((rainCount / dayCount) * 100) : 0
      return {
        summary: `Klimat dla ${city} w tym terminie (średnia z 3 lat): ${avgMin}–${avgMax}°C, ~${rainPct}% dni z opadami. Wyjazd na ${days} dni.`,
        tempMax: avgMax,
        tempMin: avgMin,
        rainDays: null,
        source: 'climate',
      }
    }
  } catch {
    return weatherCtxNone(days)
  }
}

// ——— DeepSeek ———
async function callDeepSeek(prompt: string, maxTokens: number) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 45000)
  try {
    return await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'Jesteś doświadczonym organizatorem wypraw. Zawsze zwracasz tylko jeden poprawny obiekt JSON. Wszystkie teksty pisz po polsku, zwięźle i konkretnie.',
          },
          { role: 'user', content: prompt },
        ],
      }),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw)
  } catch {
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1))
      } catch {
        return null
      }
    }
    return null
  }
}

type AiItem = {
  category: string
  name: string
  qty: string | null
  ai_reason: string | null
  shared_gear: boolean
}

function normalizeItems(parsed: Record<string, unknown> | null, mode: string): AiItem[] {
  if (!parsed || !Array.isArray((parsed as { items?: unknown }).items)) return []
  const rawItems = (parsed as { items: unknown[] }).items
  const out: AiItem[] = []
  for (const it of rawItems) {
    if (!it || typeof it !== 'object') continue
    const o = it as Record<string, unknown>
    const name = typeof o.name === 'string' ? o.name.trim() : ''
    if (!name) continue
    let category = typeof o.category === 'string' ? o.category.trim() : 'inne'
    if (!ALLOWED_CATEGORIES.includes(category)) category = 'inne'
    const qty = typeof o.qty === 'string' && o.qty.trim() ? o.qty.trim() : null
    const reason = typeof o.ai_reason === 'string' && o.ai_reason.trim() ? o.ai_reason.trim() : null
    const sharedGear = mode === 'shared' ? Boolean(o.shared_gear) : false
    out.push({ category, name, qty, ai_reason: reason, shared_gear: sharedGear })
  }
  return out.slice(0, 60)
}

function buildPersonalPrompt(opts: {
  weather: WeatherContext
  days: number
  person: { user_name?: string; activities?: string[]; intensity?: string; accommodation?: string; budget?: string; food?: string[] }
  profile: { gender?: string | null; toggles?: Record<string, boolean> }
  existingNames: string[]
}): string {
  const acts = (opts.person.activities || []).map((a) => ACTIVITY_LABELS[a] || a)
  const acc = ACCOMMODATION_LABELS[opts.person.accommodation || ''] || opts.person.accommodation || 'nieokreślony'
  const gender = GENDER_LABELS[opts.profile.gender || 'unspecified'] || 'nieokreślona'
  const toggles = Object.entries(opts.profile.toggles || {})
    .filter(([, v]) => v)
    .map(([k]) => TOGGLE_LABELS[k] || k)
  const food = (opts.person.food || []).join(', ')

  return `Zaplanuj OSOBISTĄ listę pakowania dla jednej osoby na wyjazd grupowy.

KONTEKST:
- Pogoda: ${opts.weather.summary}
- Liczba dni: ${opts.days}
- Nocleg: ${acc}
- Aktywności tej osoby: ${acts.length ? acts.join(', ') : 'brak wskazanych'}
- Tempo: ${opts.person.intensity || 'zbalansowane'}
- Płeć: ${gender}
- Dodatkowe info o osobie: ${toggles.length ? toggles.join('; ') : 'brak'}
${food ? `- Preferencje jedzeniowe: ${food}` : ''}

ZASADY:
1. To lista OSOBISTA — tylko rzeczy, które każdy pakuje sobie sam (ubrania, higiena/kosmetyki, dokumenty, własna elektronika, indywidualny sprzęt do aktywności). NIE dodawaj wspólnego sprzętu grupowego (namiot, apteczka grupowa, kuchenka, głośnik) — to osobna wspólna lista.
2. Dobierz ubrania do pogody i liczby dni. Podawaj sensowne ILOŚCI w polu "qty" (np. "${opts.days} koszulek", "${Math.ceil(opts.days * 1.4)} par skarpet", "1 kurtka") tam gdzie to ma sens; gdzie nie ma — pomiń qty.
3. HIGIENA I KOSMETYKI — NIE pakuj jednej zbiorczej "kosmetyczki". ROZBIJ ją na osobne, konkretne pozycje (kategoria "kosmetyki"), zawsze m.in.: szczoteczka do zębów, pasta do zębów (mała/podróżna), dezodorant, szampon (mała/podróżna butelka), żel pod prysznic lub mydło, grzebień/szczotka, ręcznik szybkoschnący (jeśli nocleg tego wymaga). Dodatkowo wg info o osobie:
   - mężczyzna: maszynka + pianka/żel do golenia;
   - "rozbudowana kosmetyczka / pielęgnacja": krem do twarzy, balsam do ciała, płyn micelarny, waciki;
   - "makijaż": podstawowy zestaw do makijażu + zmywacz;
   - "soczewki kontaktowe": płyn do soczewek + zapasowe soczewki/okulary;
   - "własne leki": własne leki na receptę.
   Krem z filtrem SPF dodaj TU (kategoria "kosmetyki"), jeśli pogoda słoneczna/ciepła.
4. ELEKTRONIKA — ZAWSZE dodaj osobiste podstawy (kategoria "elektronika"): ładowarka do telefonu, kabel USB do telefonu, powerbank, słuchawki. Jeśli info o osobie zawiera "sprzęt elektroniczny (laptop, tablet)": dorzuć laptop/tablet + jego ładowarkę. Przy wyjeździe za granicę rozważ adapter/przejściówkę do gniazdka, jeśli pasuje.
5. Każda pozycja ma krótkie "ai_reason" (max ~8 słów) tłumaczące dlaczego (np. "2 dni deszczu w prognozie").
6. Kategorie WYŁĄCZNIE z listy: ${ALLOWED_CATEGORIES.join(', ')}. Dobieraj trafnie: ubrania→"ubrania", higiena/pielęgnacja/SPF/makijaż→"kosmetyki", ładowarki/kable/powerbank/słuchawki/laptop→"elektronika", paszport/dowód/bilety→"dokumenty", indywidualny sprzęt do aktywności→"sprzet". "inne" tylko ostateczność.
7. NIE powtarzaj rzeczy, które już są na liście: ${opts.existingNames.length ? opts.existingNames.slice(0, 60).join(', ') : 'brak'}.
8. Maksymalnie ~28 pozycji. Konkretnie, bez lania wody — ale higiena i elektronika MUSZĄ być rozpisane wg reguł 3 i 4.

Zwróć obiekt JSON:
{
  "items": [
    { "category": "ubrania", "name": "Bluza polarowa", "qty": "1", "ai_reason": "chłodne wieczory ${opts.weather.tempMin ?? ''}°C" },
    { "category": "kosmetyki", "name": "Szczoteczka do zębów", "qty": "1", "ai_reason": "podstawa higieny" },
    { "category": "elektronika", "name": "Ładowarka do telefonu", "qty": "1", "ai_reason": "codzienne ładowanie" }
  ]
}`
}

function buildSharedPrompt(opts: {
  weather: WeatherContext
  days: number
  numPeople: number
  accommodation: string
  transport: string
  groupActivities: string[]
  existingNames: string[]
}): string {
  const acts = opts.groupActivities.map((a) => ACTIVITY_LABELS[a] || a)
  const acc = ACCOMMODATION_LABELS[opts.accommodation] || opts.accommodation || 'nieokreślony'
  // Dom/hotel: ekipa nie biwakuje — wszystko kuchenne/spaniowe/ręczniki zapewnia obiekt.
  const isHouse = opts.accommodation === 'airbnb' || opts.accommodation === 'hotel'

  const accommodationRule = isHouse
    ? `3. NOCLEG TO W PEŁNI WYPOSAŻONY WYNAJĘTY DOM / APARTAMENT / HOTEL. Zakładaj, że obiekt ma standardowe wyposażenie domowe i NIE proponuj NICZEGO z tej listy (mamy to na miejscu):
   - kuchnia: kuchenka, garnki, patelnie, sztućce, naczynia, talerze, kubki, deska, nóż kuchenny, czajnik, ekspres, pojemniki, gąbki, płyn do naczyń, lokalne przyprawy, sól, olej,
   - dom: ręczniki, pościel, koce, papier toaletowy, środki czystości, worki na śmieci, suszarka do włosów, mop/szczotka,
   - prąd/elektronika domowa: listwa zasilająca, przedłużacz, podstawowe ładowarki domowe, lampki/latarki, router/WiFi,
   - orientacja: nawigacja GPS jako urządzenie (każdy ma w telefonie).
   To wszystko jest w domu — pominięcie tych rzeczy jest OBOWIĄZKOWE.
4. Skup się na tym, co NAPRAWDĘ ma sens zabrać GRUPOWO przy pobycie w domu + aktywnościach:
   - sprzęt do wspólnych aktywności (np. zestaw/pompka do SUP, sprzęt do gier plażowych, statyw do foto, lornetka),
   - rzeczy na wspólne wycieczki/dni poza domem (torba termiczna/lodówka turystyczna na prowiant, koc piknikowy, bukłak/duża butla na wodę na trasę, plecak na wycieczki),
   - rozrywka na wieczory (głośnik bluetooth, gry planszowe / karty),
   - sprawy auta przy wyjeździe za granicę (jeśli transport=auto i kraj inny niż Polska: winieta / opłaty drogowe danego kraju, dokumenty i ubezpieczenie auta, uchwyt/ładowarka samochodowa) — sam oceń wg kraju i transportu,
   - wspólny prowiant i przekąski na drogę / pierwszy wieczór,
   - apteczka grupowa, środek na komary/kleszcze jeśli pasuje do pogody i aktywności.`
    : `3. NOCLEG TO NAMIOT / VAN (biwak) — dodaj sprzęt biwakowy wspólny: namiot, kuchenka + gaz, garnki/sztućce wspólne, latarka/lampa kempingowa, zapas wody, składany stół/krzesła. To ma sens tylko przy biwaku.
4. Dodatkowo: sprzęt do wspólnych aktywności, rozrywka (głośnik, gry), apteczka grupowa, prowiant wspólny, sprawy auta przy wyjeździe za granicę (winieta, dokumenty) jeśli pasuje.`

  return `Jesteś doświadczonym organizatorem wypraw. Przemyśl GŁĘBOKO i kompletnie, co ekipa powinna zabrać WSPÓLNIE na ten konkretny wyjazd. Zaplanuj WSPÓLNĄ listę pakowania.

KONTEKST:
- Pogoda: ${opts.weather.summary}
- Liczba dni: ${opts.days}
- Liczba osób: ${opts.numPeople || 'kilka'}
- Nocleg: ${acc}
- Transport: ${opts.transport || 'nieokreślony'}
- Aktywności ekipy: ${acts.length ? acts.join(', ') : 'ogólne'}

ZASADY:
1. To lista WSPÓLNA — TYLKO sprzęt i rzeczy współdzielone przez ekipę, które wystarczy spakować RAZ dla wszystkich. Pomyśl praktycznie o całym przebiegu wyjazdu (dojazd → dom → wspólne wycieczki → wieczory) i co się przyda grupie.
2. KATEGORYCZNY ZAKAZ rzeczy osobistych — NIE dodawaj NIGDY: ubrań (stroju kąpielowego, bluzy, kurtki, butów, czapki), kosmetyków, dokumentów osobistych, powerbanku, kremu z filtrem, okularów, leków. To wszystko każdy pakuje sobie sam na swojej osobistej liście.
${accommodationRule}
5. Pole "shared_gear": true dla rzeczy, którą ma przynieść TYLKO JEDNA osoba dla całej grupy (np. apteczka, głośnik, statyw, torba termiczna, gry). false dla rzeczy zużywalnych/wieloszt. (np. woda, prowiant).
6. Skaluj ilości do liczby osób/dni w polu "qty" gdzie ma to sens.
7. Pole "ai_reason" (to pole służy DEBUGOWANIU, nie jest pokazywane userowi): napisz konkretnie DLACZEGO ta rzecz trafia na listę WSPÓLNĄ i czemu akurat ona ma sens przy tym noclegu/aktywnościach (1 zdanie). Bądź rzeczowy.
8. Kategorie WYŁĄCZNIE z: ${ALLOWED_CATEGORIES.join(', ')}.
9. NIE powtarzaj: ${opts.existingNames.length ? opts.existingNames.slice(0, 60).join(', ') : 'brak'}.
10. Zwróć BOGATĄ, kompletną listę: ${Math.max(14, Math.min(22, (opts.numPeople || 4) * 3 + 8))} – 22 trafnych pozycji. Lepiej pełna i przemyślana niż uboga, ale każda pozycja musi mieć realny sens (zero zapychaczy, zero rzeczy które ma dom).

Zwróć obiekt JSON:
{
  "items": [
    { "category": "sprzet", "name": "Apteczka grupowa", "qty": "1", "ai_reason": "Jedna porządna apteczka na ekipę wystarczy; przy trekkingu kluczowa.", "shared_gear": true }
  ]
}`
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const mode = body.mode === 'shared' ? 'shared' : 'personal'
  const room = (body.room || {}) as Record<string, unknown>
  const startDate = (room.start_date as string) || null
  const endDate = (room.end_date as string) || null
  const city = (room.end_city as string) || (room.start_city as string) || ''
  const country = (room.country as string) || ''
  const days = daysBetween(startDate, endDate)
  const existingNames = Array.isArray(body.existingNames) ? (body.existingNames as string[]) : []

  if (!process.env.DEEPSEEK_API_KEY) {
    return NextResponse.json({ error: 'Brak konfiguracji AI' }, { status: 500 })
  }

  const weather = await buildWeather(city, country, startDate, endDate)

  let prompt: string
  if (mode === 'shared') {
    prompt = buildSharedPrompt({
      weather,
      days,
      numPeople: Number(room.num_people) || 0,
      accommodation: (body.accommodation as string) || (room.transport === 'van' ? 'van' : ''),
      transport: (room.transport as string) || '',
      groupActivities: Array.isArray(body.groupActivities) ? (body.groupActivities as string[]) : [],
      existingNames,
    })
  } else {
    const person = (body.person || {}) as Record<string, unknown>
    const profile = (body.profile || {}) as Record<string, unknown>
    prompt = buildPersonalPrompt({
      weather,
      days,
      person: {
        user_name: person.user_name as string,
        activities: Array.isArray(person.activities) ? (person.activities as string[]) : [],
        intensity: person.intensity as string,
        accommodation: person.accommodation as string,
        budget: person.budget as string,
        food: Array.isArray(person.food) ? (person.food as string[]) : [],
      },
      profile: {
        gender: (profile.gender as string) || null,
        toggles: (profile.toggles as Record<string, boolean>) || {},
      },
      existingNames,
    })
  }

  try {
    // Wspólna lista jest teraz bogatsza (do ~22 pozycji z dłuższym uzasadnieniem) — więcej tokenów.
    const res = await callDeepSeek(prompt, mode === 'shared' ? 3200 : 2800)
    if (!res.ok) {
      const text = await res.text()
      return NextResponse.json({ error: `AI error ${res.status}: ${text}`, weatherSummary: weather.summary }, { status: 502 })
    }
    const data = await res.json()
    const rawText = data.choices?.[0]?.message?.content || '{}'
    const parsed = parseJsonObject(rawText)
    const items = normalizeItems(parsed, mode)
    return NextResponse.json({ items, weatherSummary: weather.summary, weatherSource: weather.source })
  } catch (err) {
    return NextResponse.json({ error: String(err), weatherSummary: weather.summary }, { status: 500 })
  }
}
