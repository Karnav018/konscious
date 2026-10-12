// A short sound when a nudge arrives.
//
// Synthesised rather than bundled: two sine notes through WebAudio is a few
// lines and no asset, and it means the sound can be tuned by changing a
// number instead of re-recording a file. It is deliberately quiet and
// deliberately two notes — a single beep reads as an error, and a rising
// pair reads as "something for you".
//
// The schedule is pure and tested; only play() touches the browser.

/** One note: when it starts after the chime begins, and how long it lasts. */
export interface Note {
  hz: number
  atMs: number
  forMs: number
}

/** A rising fifth-ish pair. Short enough to be over before you look up. */
export const NOTES: readonly Note[] = [
  { hz: 660, atMs: 0, forMs: 90 },
  { hz: 880, atMs: 70, forMs: 130 },
]

/** Peak gain. Low on purpose: this plays while you are working, and anything
 *  louder becomes the thing you turn off rather than the thing you notice. */
export const GAIN = 0.07

/** A note's shape in seconds, from a context's current time. Attack and
 *  release are ramps rather than steps, because a square edge on a sine is
 *  a click. */
export function envelope(note: Note, from: number): { start: number; peak: number; end: number } {
  const start = from + note.atMs / 1000
  return {
    start,
    // Fast but not instant; 12ms is enough to lose the click.
    peak: start + 0.012,
    end: start + note.forMs / 1000,
  }
}

/** How long the whole chime runs, in ms — the last note's end. */
export const lengthMs = (notes: readonly Note[] = NOTES): number =>
  notes.reduce((end, n) => Math.max(end, n.atMs + n.forMs), 0)

let ctx: AudioContext | null = null

/** Plays the chime, or does nothing where there is no audio to play it on.
 *  Never throws: a missing or blocked AudioContext must not take a reminder
 *  down with it. */
export function play(notes: readonly Note[] = NOTES, gain = GAIN): void {
  try {
    const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    ctx ??= new Ctor()
    // A webview may hand back a suspended context until something is clicked.
    if (ctx.state === 'suspended') void ctx.resume()
    const from = ctx.currentTime
    for (const note of notes) {
      const { start, peak, end } = envelope(note, from)
      const osc = ctx.createOscillator()
      const vol = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = note.hz
      vol.gain.setValueAtTime(0, start)
      vol.gain.linearRampToValueAtTime(gain, peak)
      vol.gain.exponentialRampToValueAtTime(0.0001, end)
      osc.connect(vol).connect(ctx.destination)
      osc.start(start)
      osc.stop(end + 0.02)
    }
  } catch {
    /* no sound is a fine outcome; a thrown reminder is not */
  }
}
