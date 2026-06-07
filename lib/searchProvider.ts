// ——————————————————————————————————————————————
// Abstrakcja wyszukiwania webowego (do offline ingestu blogów).
//
// Jedyne miejsce zależne od dostawcy. Dziś: Brave Search API.
//
// Dlaczego Brave, a nie Google CSE: od 20.01.2026 nowe wyszukiwarki Google
// Programmable Search nie mogą już używać trybu "Search the entire web" —
// dają tylko "sites to search" (wąska lista domen). Brave ma własny,
// niezależny indeks całego internetu z prostym REST API i darmowym tierem.
//
// Gdyby kiedyś trzeba było zmienić dostawcę — podmieniamy WYŁĄCZNIE
// implementację `searchWeb` poniżej; reszta pipeline'u (ingest) zostaje
// bez zmian, bo kontrakt (WebResult) jest stały.
//
// Env (placeholder — wartość wklejasz w Vercel):
//   BRAVE_API_KEY  — token subskrypcji z https://brave.com/search/api/
// ——————————————————————————————————————————————

export type WebResult = {
  title: string
  url: string
  snippet: string
}

const BRAVE_API_KEY = (process.env.BRAVE_API_KEY || '').trim()

export function isSearchConfigured(): boolean {
  return Boolean(BRAVE_API_KEY)
}

/**
 * Zwraca listę wyników web search (tytuł + URL + snippet).
 * Best-effort: przy braku konfiguracji lub błędzie zwraca [].
 *
 * @param query  zapytanie (np. "best SUP lakes near Bled blog")
 * @param limit  ile wyników (Brave: max 20 na zapytanie)
 */
export async function searchWeb(query: string, limit = 8, freshness?: string): Promise<WebResult[]> {
  if (!isSearchConfigured() || !query.trim()) return []
  const count = Math.max(1, Math.min(20, limit))
  // freshness: 'pd'|'pw'|'pm'|'py' (dzień/tydzień/miesiąc/rok) — pod wydarzenia/aktualności
  const fresh = ['pd', 'pw', 'pm', 'py'].includes(freshness || '') ? `&freshness=${freshness}` : ''
  try {
    const url =
      `https://api.search.brave.com/res/v1/web/search` +
      `?q=${encodeURIComponent(query)}` +
      `&count=${count}${fresh}`
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': BRAVE_API_KEY,
      },
    })
    if (!res.ok) return []
    const data = await res.json()
    const items = Array.isArray(data?.web?.results) ? data.web.results : []
    return items
      .map((it: any): WebResult => ({
        title: String(it?.title || '').trim(),
        url: String(it?.url || '').trim(),
        snippet: String(it?.description || '').trim(),
      }))
      .filter((r: WebResult) => r.url)
  } catch {
    return []
  }
}
