// Generuje i zapisuje anonimowy identyfikator sesji w localStorage
export function getSessionId(): string {
  if (typeof window === 'undefined') return 'server'
  
  let sessionId = localStorage.getItem('trip_session_id')
  if (!sessionId) {
    sessionId = `user_${Math.random().toString(36).substr(2, 9)}_${Date.now()}`
    localStorage.setItem('trip_session_id', sessionId)
  }
  return sessionId
}

export function getSessionName(): string {
  if (typeof window === 'undefined') return 'Nieznajomy'
  return localStorage.getItem('trip_user_name') || 'Nieznajomy'
}

export function setSessionName(name: string): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem('trip_user_name', name)
  }
}

export function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let result = ''
  for (let i = 0; i < 6; i++) {
    result += chars[Math.floor(Math.random() * chars.length)]
  }
  return result
}

// ——— Historia pokojów ———

export type RoomHistory = {
  code: string
  name: string       // nazwa wyprawy
  joinedAt: string   // data dołączenia
  userName: string   // imię użytkownika
}

export function getRoomHistory(): RoomHistory[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem('trip_room_history')
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function saveRoomToHistory(code: string, tripName: string, userName: string): void {
  if (typeof window === 'undefined') return
  const history = getRoomHistory().filter(r => r.code !== code) // usuń duplikat
  const entry: RoomHistory = {
    code,
    name: tripName,
    joinedAt: new Date().toISOString(),
    userName,
  }
  // Trzymaj max 5 pokojów, najnowszy na górze
  const updated = [entry, ...history].slice(0, 5)
  localStorage.setItem('trip_room_history', JSON.stringify(updated))
}

export function removeRoomFromHistory(code: string): void {
  if (typeof window === 'undefined') return
  const history = getRoomHistory().filter(r => r.code !== code)
  localStorage.setItem('trip_room_history', JSON.stringify(history))
}
