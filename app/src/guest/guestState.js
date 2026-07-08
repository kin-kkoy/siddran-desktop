// Guest ("try it free") demo mode — a module-level flag so non-React consumers
// (authFetch's branch, the image uploader, the storage override) can all read
// one source of truth without prop-threading. It is INTENTIONALLY never
// persisted: a page refresh reloads this module fresh with active=false, which
// is what drops a guest straight back to the login page with all data gone.
let active = false

export const isGuestActive = () => active
export const setGuestActive = (v) => { active = !!v }
