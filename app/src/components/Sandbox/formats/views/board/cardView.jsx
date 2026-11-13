import { useCallback, useState } from 'react'
import { LuFilter, LuArrowUpDown, LuSlidersHorizontal } from 'react-icons/lu'
import t from '../../Table.module.css'
import Popover from '../../Popover'
import StyleBar from '../table/StyleBar'
import { FilterMenu, SortMenu } from '../TableMenus'
import { activeFilterCount } from '../../query'

/**
 * The toolbar Kanban and Matrix share: Filter, Sort, the view's settings and
 * the Table's style bar for the cards
 * (useCards.jsx has the card rules they share).
 */

/** The toolbar over a card view. `settings` renders the view's own settings menu. */
export function ViewBar({ fields, cfg, onConfig, shown, total, settings, extra, styleBar }) {
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
            <span className={t.grow} />
            {styleBar}
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

/**
 * The Table's style bar over cards: with a card selected it styles that card,
 * otherwise every card in the view (so it's never dimmed). Kept in the view's
 * settings (`styles`, boards.js applyCardStyle).
 */
export function CardStyleBar({ cur, selected, apply }) {
    return (
        <>
            <span className={t.count} title={selected ? 'The style bar formats the selected card' : 'The style bar formats every card (select one to format just it)'}>
                {selected ? 'This card' : 'All cards'}
            </span>
            <StyleBar cur={cur} enabled apply={apply} label={selected ? 'Format the selected card' : 'Format every card'} />
        </>
    )
}
