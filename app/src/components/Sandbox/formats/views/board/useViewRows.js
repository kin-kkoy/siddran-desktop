import { useMemo, useState } from 'react'
import { tableRows } from '../../query'

/**
 * A card view's records: formulas computed, then its own filter and sort
 * (query.js, the Table's), in the records' own order otherwise. Cards added
 * here since the filter last changed stay shown even if it would hide them,
 * as in the Table, so a new card doesn't vanish as it's made.
 */
export function useViewRows(source, cfg) {
    const [kept, setKept] = useState({ sig: '', ids: new Set() })
    const sig = JSON.stringify([cfg.filters || [], cfg.match || 'all'])
    const keep = useMemo(() => (kept.sig === sig ? kept.ids : new Set()), [kept, sig])
    const query = useMemo(() => ({ filters: cfg.filters, match: cfg.match, sorts: cfg.sorts }), [cfg.filters, cfg.match, cfg.sorts])
    const t = useMemo(() => tableRows(source, query, { keep }), [source, query, keep])
    const stale = useMemo(() => {
        if (!keep.size) return null
        const shown = new Set(tableRows(source, query).rows.map(r => r.id))
        return new Set([...keep].filter(id => !shown.has(id)))
    }, [source, query, keep])
    const keepNew = (id) => { if (id) setKept(k => ({ sig, ids: new Set(k.sig === sig ? k.ids : []).add(id) })) }
    const sorted = (cfg.sorts || []).some(s => source.fields.some(f => f.id === s.field))
    return { t, keepNew, stale, sorted }
}
