export const compareByFavorite = (a, b) => {
  if (a?.is_favorite && !b?.is_favorite) return -1
  if (!a?.is_favorite && b?.is_favorite) return 1
  return 0
}
