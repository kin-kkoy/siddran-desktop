# Completed tasks hidden by default, and the setting should stick

**Done 2026-08-28.** Persisted in `localStorage` under `tasksShowCompleted` (the
user chose device-local over a Settings row), read in the `useState` initialiser so
the masonry pass sees the settled value. Kanban shares the same `filteredTasks`
chain, so no separate filter was needed.

**Area:** Tasks · **Size:** small

## What was seen

> Completed tasks should by default always be hidden. This should also fix the
> bug where Hiding Completed tasks immediately become unhidden the moment I
> leave the TasksHub so coming back shows the tasks even though I had clicked
> the Hide Completed button earlier.

Two things, and the user is right that they are the same fix.

## Verified

`pages/Tasks/TasksHub.jsx:75`:

```js
const [showCompleted, setShowCompleted] = useState(true)
```

Plain component state, defaulting to **shown**. Nothing persists it, so leaving
the page unmounts the component and the next visit starts from `true` again.
That is exactly the reported bug — the click was never being forgotten, it was
never being remembered.

Used at `:146` (the filter), `:302` (a masonry dep) and `:631` (the button
label).

## Not decided

- **Where it should persist.** Two candidates, and they mean different things:
  - `localStorage`, like `notesViewMode` / `notesDensity` — a per-device view
    preference, not synced, invisible in Settings.
  - A real setting in `SettingsContext` `DEFAULTS` — appears in the Settings
    modal, and `cinder_settings` is global rather than Bag-scoped.

  Toggling it lives on the Tasks toolbar either way, so a Settings row may be a
  second place to change one thing. Lean localStorage unless the user wants it
  in Settings; ask.
- Whether "hidden by default" means for existing users too. Flipping the default
  changes behaviour for someone who has never touched the button — which is the
  request, but worth saying out loud.

## Watch out for

- `showCompleted` is a dependency of `useRowMasonry` at `:302`. If persistence
  is added by reading storage during the first render, make sure the masonry
  pass sees the settled value and not the default followed by a correction — a
  layout that reflows once on entry will read as a flicker.
- Check whether the kanban view filters completed tasks the same way. The card
  and kanban views have separate sort state already (`sortByView`); confirm
  whether they share this one before assuming.
