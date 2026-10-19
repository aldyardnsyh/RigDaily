// cn() - penggabung class aman (tanpa deps tambahan agar ringan di Electron)
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
