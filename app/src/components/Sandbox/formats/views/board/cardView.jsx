import { useCallback, useState } from 'react'
import { LuFilter, LuArrowUpDown, LuSlidersHorizontal } from 'react-icons/lu'
import t from '../../Table.module.css'
import Popover from '../../Popover'
import { FilterMenu, SortMenu } from '../TableMenus'
import { activeFilterCount } from '../../query'

/**
 * The toolbar Kanban and Matrix share: Filter, Sort and the view's settings
 * (useCards.jsx has the card rules they share).
 */

/** The toolbar over a card view. `settings` renders the view's own settings menu. */
export function ViewBar({ fields, cfg, onConfig, shown, total, settings, extra }) {
    const [menu, setMenu] = useState(null)   // { kind, anchor }
    const close = useCallback(() => setMenu(null), [])
    const open = (kind, e) => { const anchor = e.currentTarget; setMenu(m => (m?.kind === kind && m.anchor === anchor ? null : { kind, anchor })) }
    const nFilters = activeFilterCount(cfg, fields)
    const nSorts = (cfg.sorts || []).filter(s => fields.some(f => f.id === s.field)).length
    return (
        <div className={t.toolbar}>
            <button className={`${t.tool} ${nFilters ? t.toolOn : ''}`} onClick={(e) => open('filter', e)} aria-label="Filter">
                <LuFilter size="1em" /> Filter{nFilters ? ` · ${nFilters}` : ''}
            </button>
            <button className={`${t.tool} ${nSorts ? t.toolOn : ''}`} onClick={(e) => open('sort', e)} aria-label="Sort"
                title={nSorts ? 'Sorted: cards keep this order (drag between cells still works)' : 'Sort the cards in each cell'}>
                <LuArrowUpDown size="1em" /> Sort{nSorts ? ` · ${nSorts}` : ''}
            </button>
            <button className={t.tool} onClick={(e) => open('settings', e)} aria-label="View settings">
                <LuSlidersHorizontal size="1em" /> View
            </button>
            {extra}
            {shown !== total && <span className={t.count}>{shown} of {total}</span>}
            {menu && (
                <Popover anchor={menu.anchor} onClose={close} width={menu.kind === 'filter' ? 440 : menu.kind === 'sort' ? 360 : 290} label={menu.kind}>
                    {menu.kind === 'filter' && <FilterMenu fields={fields} config={cfg} onConfig={onConfig} />}
                    {menu.kind === 'sort' && <SortMenu fields={fields} config={cfg} onConfig={onConfig} />}
                    {menu.kind === 'settings' && settings(close)}
                </Popover>
            )}
        </div>
    )
}
