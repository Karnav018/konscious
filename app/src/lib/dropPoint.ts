// Where a file drop landed, in the page's CSS pixels.
//
// Tauri labels the drop position "physical", but passes on whatever the
// platform layer (wry) measured without converting it:
// - macOS: AppKit points, already flipped to a top-left origin. Points are
//   what CSS pixels are, so they are used as they are — dividing by the
//   Retina scale would aim every drop at half the distance from the corner.
// - Windows: real screen pixels (ScreenToClient), so they are divided by the
//   display scale.
// - Linux: GTK widget coordinates, which are logical pixels like macOS
//   points, so they too are used as they are.
export function dropPoint(x: number, y: number, scale: number, windows: boolean) {
  const s = windows && scale > 0 ? scale : 1
  return { x: x / s, y: y / s }
}
