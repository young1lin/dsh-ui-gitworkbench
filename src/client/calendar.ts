/**
 * The pure arithmetic of the filter's calendar.
 *
 * A month is a fixed 6×7 grid, Monday-first: a stable height whatever the
 * month (no layout jump when February needs four rows), with neighbouring
 * months' days filling the lead-in and tail — greyed, still clickable, the
 * way every modern calendar behaves. Everything here is pure and takes
 * `todayIso` explicitly so tests are deterministic.
 *
 * @module @young1lin/dsh-ui-gitworkbench/calendar
 */

/** One day cell. `null` where the grid has no day at all (never, at 6×7). */
export interface CalendarCell {
  /** The day, `yyyy-mm-dd` — the grammar the filter speaks end to end. */
  readonly iso: string
  /** Day-of-month number shown in the cell. */
  readonly day: number
  /** Whether the cell belongs to the displayed month. */
  readonly inMonth: boolean
  /** Whether the cell is the supplied today. */
  readonly isToday: boolean
}

const DAY_MS = 86_400_000

function toIso(date: Date): string {
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${date.getUTCFullYear()}-${m}-${d}`
}

/**
 * The 6×7 Monday-first grid for one month.
 * @param year - displayed year.
 * @param month - displayed month, 0-based like `Date`.
 * @param todayIso - what counts as today, for the accent; `''` accents nothing.
 */
export function monthGrid(year: number, month: number, todayIso: string): readonly (readonly (CalendarCell | null)[])[] {
  // Day 1 of the month, at a UTC midnight so arithmetic never drifts an hour.
  const first = new Date(Date.UTC(year, month, 1))
  // getUTCDay is Sunday=0; Monday-first offset.
  const lead = (first.getUTCDay() + 6) % 7
  const start = new Date(first.getTime() - lead * DAY_MS)
  const weeks: (CalendarCell | null)[][] = []
  for (let w = 0; w < 6; w += 1) {
    const row: (CalendarCell | null)[] = []
    for (let d = 0; d < 7; d += 1) {
      const date = new Date(start.getTime() + (w * 7 + d) * DAY_MS)
      const iso = toIso(date)
      row.push({ iso, day: date.getUTCDate(), inMonth: date.getUTCMonth() === month, isToday: iso === todayIso })
    }
    weeks.push(row)
  }
  return weeks
}

/**
 * Single-letter weekday header row, Monday-first, via the viewer's own locale
 * (or an explicit one, which is what the test does).
 * @param locale - BCP 47 tag; undefined means the runtime default.
 */
export function weekdayLabels(locale?: string): readonly string[] {
  // 2023-01-02..08 is a Monday..Sunday — label those, whatever the locale.
  const labels: string[] = []
  for (let d = 2; d <= 8; d += 1) {
    labels.push(new Intl.DateTimeFormat(locale, { weekday: 'narrow' }).format(new Date(Date.UTC(2023, 0, d))))
  }
  return labels
}

/** Today as `yyyy-mm-dd` in the viewer's local timezone (for `todayIso`). */
export function localTodayIso(): string {
  const now = new Date()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${m}-${d}`
}
