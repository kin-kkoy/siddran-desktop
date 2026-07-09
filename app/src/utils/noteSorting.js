export const compareByFavorite = (a, b) => {
  if (a?.is_favorite && !b?.is_favorite) return -1
  if (!a?.is_favorite && b?.is_favorite) return 1
  return 0
}

// Manual drag-sort order. Items with an explicit numeric `order` sort ascending;
// items without one (e.g. freshly created, before any reorder) keep their
// insertion order after the ordered ones. So before a group is ever reordered
// this is a no-op (stable), and after it reflects exactly what the user dragged.
export const compareByOrder = (a, b) => {
  const ao = typeof a?.order === 'number' ? a.order : null
  const bo = typeof b?.order === 'number' ? b.order : null
  if (ao !== null && bo !== null) return ao - bo
  if (ao !== null) return -1
  if (bo !== null) return 1
  return 0
}
