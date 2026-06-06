// Flagi funkcji opcjonalnych (nie-stałych dla publicznej aplikacji).
// Przewodnik z PDF (Couple Away) — prywatny dodatek „dla nas".
// Wyłączenie: ustaw GUIDE_ENABLED = false (zakładka znika, reszta bez zmian).
// Usunięcie całości: skasuj GuideTab.tsx + wpis w AppShell + DROP TABLE guide_places.
export const GUIDE_ENABLED = true

// Asystent AI (czat o Słowenii + miejscach z poradnika, plan dnia).
// Wyłączenie: ASSISTANT_ENABLED = false (zakładka znika).
// Usunięcie: skasuj AssistantTab.tsx + /api/assistant + wpis w AppShell + DROP TABLE assistant_messages.
export const ASSISTANT_ENABLED = true
