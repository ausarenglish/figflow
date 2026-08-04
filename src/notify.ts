import { execFileSync } from 'node:child_process'

/** Desktop notification on macOS; a no-op everywhere else. */
export function notify(title: string, message: string, subtitle?: string): void {
  if (process.platform !== 'darwin') return

  const esc = (text: string) => text.replace(/["\\]/g, '\\$&').replace(/\n/g, ' ')
  const script =
    `display notification "${esc(message)}" with title "${esc(title)}"` +
    (subtitle ? ` subtitle "${esc(subtitle)}"` : '') +
    ' sound name "Ping"'

  try {
    execFileSync('osascript', ['-e', script], { stdio: 'ignore' })
  } catch {
    // Notifications are a nicety — never fail a sync over one.
  }
}
