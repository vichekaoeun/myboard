// Stacking helper: an item's saved `z` (falling back to its type default),
// with a large temporary boost while selected so its handles stay accessible.
const SELECTED_BOOST = 100000

export function stackZ(item, base, selected) {
  const z = item && item.z != null ? item.z : base
  return z + (selected ? SELECTED_BOOST : 0)
}
