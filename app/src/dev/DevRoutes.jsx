import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'

// Dev-only routes. This module is reached through a single `import.meta.env.DEV`
// guard in App.jsx, so Vite folds the branch to `false` for a production build
// and Rollup drops this file — and everything it imports — from the bundle
// entirely. Nothing under src/dev/ ships in the AppImage.
//
// Keeping the routes together in one lazily-imported module is what makes that
// possible: a per-route `lazy()` in App.jsx would leave several dynamic imports
// scattered through live code, each emitting a chunk.
const BookSpike = lazy(() => import('./BookSpike.jsx'))
const PagedEditor = lazy(() => import('./PagedEditor.jsx'))

const Loading = () => <div style={{ padding: 24 }}>Loading…</div>

export default function DevRoutes() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="book-spike" element={<BookSpike />} />
        <Route path="paged-editor" element={<PagedEditor />} />
      </Routes>
    </Suspense>
  )
}
