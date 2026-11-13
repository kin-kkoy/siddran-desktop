import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { LuPlus, LuEllipsisVertical, LuChevronRight, LuChevronDown, LuChevronsRightLeft } from 'react-icons/lu'
import styles from '../Board.module.css'
import t from '../Table.module.css'
import Popover from '../Popover'
import Card, { AddCard } from './board/Card'
import { ViewBar, CardStyleBar } from './board/cardView'
import { useCards } from './board/useCards'
import { ViewSettings, ColumnMenu } from './board/BoardMenus'
import { useCardDrag } from './board/useCardDrag'
import { useViewRows } from './board/useViewRows'
import { kanbanSetup, kanbanColumns, kanbanLanes, kanbanCells, cellKey, cardFields, applyCardStyle, cardLook, primaryField, dropPatch, dropBefore, valueOf, NONE } from '../boards'
import { orderRecords } from '../layout'
import { optionHue } from '../fields'
import { STATUS_OPTIONS } from '../formats'

/**
 * The Kanban view (spec §13.6): one column per option of a select field (in
 * the option order), optional swimlanes by a second one, records as cards.
 * Dragging a card to another column (or lane) sets those fields; within a
 * column it sets the record's order — one undo step either way (R13.47).
 * Settings live in payload.kanban (boards.js). Reads and writes only through
 * `source`, so it works over own records and linked tasks alike.
 */

const COL_W = '14em', COL_FOLDED = '2.8em'

function KanbanView({ source, item, onConfig }) {
    const cfg = useMemo(() => item?.payload?.kanban || {}, [item?.payload?.kanban])
    const { t: rows, keepNew, stale, sorted } = useViewRows(source, cfg)
    const fields = source.fields
    const setup = kanbanSetup(fields, cfg)
    const { column, lane } = setup
    const primary = primaryField(fields)
    const columns = kanbanColumns(column, cfg)
    const lanes = kanbanLanes(lane)
    const cells = useMemo(() => kanbanCells(rows.rows, setup, columns), [rows.rows, setup.column, setup.lane, cfg.hideEmpty])   // eslint-disable-line react-hooks/exhaustive-deps
    const shown = cardFields(fields, cfg, { exclude: [primary?.id, column?.id, lane?.id] })
    const collapsed = new Set(cfg.collapsed || [])
    const lanesFolded = new Set(cfg.lanesCollapsed || [])
    const size = cfg.size || 'default'

    const rootRef = useRef(null), scrollRef = useRef(null)
    const [adding, setAdding] = useState(null)   // the cell key with its add box open
    const [menu, setMenu] = useState(null)       // { colKey, anchor }
    const closeMenu = useCallback(() => setMenu(null), [])
    const cfgSet = useCallback((fn) => onConfig?.(fn), [onConfig])

    // The order the cards read in: lane by lane, column by column (the detail panel and the arrows step through it).
    const order = useMemo(() => {
        const out = []
        for (const l of lanes) for (const c of columns) for (const r of cells.get(cellKey(l.key, c.key)) || []) out.push(r.id)
        return out
    }, [cells, lanes, columns])

    const onDrop = (d) => {
        const [lk, ck] = d.cell.split('\u0001')
        const rec = rows.all.find(r => r.id === d.rid)
        if (!rec) return
        const patch = dropPatch(rec, [[column, ck], [lane, lk]])
        // Sorted cards keep the sort's order; tasks keep their own.
        const before = source.canReorder && !sorted
            ? dropBefore(orderRecords(source.records).map(r => r.id), (cells.get(d.cell) || []).map(r => r.id), d.rid, d.over, d.place)
            : undefined
        if (!Object.keys(patch).length && before === undefined) return
        source.moveTo?.(d.rid, patch, before)
    }
    const { drag, down } = useCardDrag({ rootRef, scrollRef, onDrop, onClick: (ev, rid) => cards.api.click(ev, rid) })
    const cards = useCards({ source, primary, all: rows.all, order, rootRef, down, onStyleKey: (k) => applyLook({ [k]: !curLook?.[k] }) })
    // The style bar: the selected card, else every card.
    const curLook = cards.sel ? cardLook(cfg.styles, cards.sel) : cfg.styles?.all || null
    const applyLook = (patch) => cfgSet(c => ({ ...c, styles: applyCardStyle(c.styles, cards.sel, patch) }))

    // Linked tasks: a new task lands where its defaults put it, so only that cell offers to add.
    const canAddIn = (lk, ck) => {
        if (!source.canAdd) return false
        if (source.type === 'own') return true
        const want = (f) => (f ? (typeof source.newValues?.[f.id] === 'string' ? source.newValues[f.id] : NONE) : null)
        return want(column) === ck && (!lane || want(lane) === lk)
    }
    const add = (lk, ck, text) => {
        const values = primary ? { [primary.id]: text } : {}
        if (source.type === 'own') {
            if (ck !== NONE) values[column.id] = valueOf(ck)
            if (lane && lk !== NONE) values[lane.id] = valueOf(lk)
        }
        keepNew(source.add(values))
    }

    if (!column) {
        return (
            <div className={styles.view}>
                <div className={styles.setup}>
                    <p>A Kanban sorts cards into columns by a <b>Select</b> field — there isn’t one yet.</p>
                    {source.fieldsEditable && (
                        <button className={t.popBtn} onClick={() => source.addField({ name: 'Status', type: 'select', options: [...STATUS_OPTIONS] })}>
                            <LuPlus size={13} /> Add a Status field
                        </button>
                    )}
                </div>
            </div>
        )
    }

    const counts = new Map(columns.map(c => [c.key, lanes.reduce((n, l) => n + (cells.get(cellKey(l.key, c.key))?.length || 0), 0)]))
    const gridCols = [...columns.map(c => (collapsed.has(c.key) ? COL_FOLDED : COL_W)), ...(source.fieldsEditable ? ['2.4em'] : [])].join(' ')
    const menuCol = menu && columns.find(c => c.key === menu.colKey)
    const optCols = columns.filter(c => c.key !== NONE)

    const toggleFold = (k) => cfgSet(x => ({ ...x, collapsed: (x.collapsed || []).includes(k) ? x.collapsed.filter(y => y !== k) : [...(x.collapsed || []), k] }))
    const renderCell = (l, c) => {
        const key = cellKey(l.key, c.key)
        const list = cells.get(key) || []
        const folded = collapsed.has(c.key)
        const over = drag?.cell === key && !drag.over
        const tint = c.key !== NONE ? { '--col-hue': optionHue(c.key) } : undefined
        if (folded) {
            // A folded column is one tall strip: a click anywhere on it opens it again (and it still takes a dropped card).
            return (
                <div key={key} data-cell={key} role="button" tabIndex={-1} title={`Expand ${c.label}`} style={tint}
                    className={[styles.kcell, styles.kcellFolded, over && styles.cellOver].filter(Boolean).join(' ')}
                    onClick={() => toggleFold(c.key)}>
                    {list.length > 0 && <span className={styles.foldCount}>{list.length}</span>}
                </div>
            )
        }
        return (
            <div key={key} data-cell={key} style={tint} className={[styles.kcell, over && styles.cellOver].filter(Boolean).join(' ')} role="list">
                {list.map(r => (
                    <Card key={r.id} rec={r} primary={primary} shown={shown} colorBy={setup.colorBy} size={size} look={cardLook(cfg.styles, r.id)}
                        selected={cards.sel === r.id} editing={cards.editing === r.id} editable={!!primary && source.editable.has(primary.id)}
                        canRemove={source.canRemove} drop={drag?.over === r.id ? drag.place : null} dragging={drag?.rid === r.id}
                        stale={!!stale?.has(r.id)} api={cards.api} />
                ))}
                {adding === key ? (
                    <AddCard placeholder={primary ? `Type a ${primary.name.toLowerCase()}, Enter` : 'Enter to add'}
                        onAdd={(text) => add(l.key, c.key, text)} onClose={() => setAdding(null)} />
                ) : canAddIn(l.key, c.key) ? (
                    <button className={styles.addCard} onClick={() => setAdding(key)}><LuPlus size="1em" /> Add a card</button>
                ) : null}
            </div>
        )
    }

    return (
        <div ref={rootRef} className={styles.view} tabIndex={0} onKeyDown={cards.onKeyDown}>
            <ViewBar fields={fields} cfg={cfg} onConfig={cfgSet} shown={rows.rows.length} total={rows.total}
                styleBar={<CardStyleBar cur={curLook} selected={!!cards.sel} apply={applyLook} />}
                settings={() => (
                    <ViewSettings kind="kanban" fields={fields} cfg={cfg} setup={setup} primary={primary} onConfig={cfgSet} source={source} />
                )} />
            {/* data-sb-scroll: the board's wheel scrolls this (both ways) instead of zooming. */}
            <div ref={scrollRef} className={styles.kscroll} data-sb-scroll="true"
                onPointerDown={(e) => { if (!e.target.closest('[data-rid]')) cards.setSel(null) }}>
                <div className={styles.kgrid} style={{ gridTemplateColumns: gridCols }}>
                    {columns.map((c, i) => {
                        const folded = collapsed.has(c.key)
                        const n = counts.get(c.key)
                        const wip = cfg.wip?.[c.key]
                        const tint = c.key !== NONE ? { '--col-hue': optionHue(c.key) } : undefined
                        const count = (
                            <span className={`${styles.kcount} ${wip && n > wip ? styles.overLimit : ''}`} title={wip ? `Limit ${wip}${n > wip ? ' — over the limit' : ''}` : undefined}>
                                {wip ? `${n}/${wip}` : n}
                            </span>
                        )
                        if (folded) {
                            return (
                                <button key={`h:${c.key}`} className={`${styles.khead} ${styles.kheadFolded}`} style={tint}
                                    onClick={() => toggleFold(c.key)} title={`Expand ${c.label}`} aria-label={`Expand ${c.label}`}>
                                    <span className={styles.kfoldName}>{c.label}</span>
                                    {count}
                                </button>
                            )
                        }
                        return (
                            <div key={`h:${c.key}`} className={styles.khead} style={tint}>
                                <span className={`${styles.kheadName} ${c.key === NONE ? styles.kheadNone : ''}`} title={c.label}>{c.label}</span>
                                {count}
                                <button className={styles.kmenu} onClick={() => toggleFold(c.key)} title="Collapse the column" aria-label={`Collapse ${c.label}`}>
                                    <LuChevronsRightLeft size="1em" />
                                </button>
                                <button className={styles.kmenu} onClick={(e) => { const anchor = e.currentTarget; setMenu(m => (m?.colKey === c.key ? null : { colKey: c.key, anchor, first: i === 0, last: i === optCols.length - 1 })) }}
                                    title="Column settings" aria-label={`${c.label} settings`}><LuEllipsisVertical size="1em" /></button>
                            </div>
                        )
                    })}
                    {source.fieldsEditable && (
                        <button className={styles.kaddCol} title={`Add a column (a new ${column.name} option)`} aria-label="Add a column"
                            onClick={() => {
                                const taken = new Set(column.options || [])
                                let name = 'New column', n = 2
                                while (taken.has(name)) name = `New column ${n++}`
                                source.addOption(column.id, name)
                            }}><LuPlus size="1.1em" /></button>
                    )}
                    {lanes.map(l => {
                        const folded = lanesFolded.has(l.key)
                        const laneCount = columns.reduce((n, c) => n + (cells.get(cellKey(l.key, c.key))?.length || 0), 0)
                        return [
                            lane && (
                                <button key={`l:${l.key}`} className={styles.laneHead}
                                    onClick={() => cfgSet(x => ({ ...x, lanesCollapsed: folded ? (x.lanesCollapsed || []).filter(k => k !== l.key) : [...(x.lanesCollapsed || []), l.key] }))}>
                                    {folded ? <LuChevronRight size="1em" /> : <LuChevronDown size="1em" />}
                                    <span className={l.key === NONE ? styles.kheadNone : undefined}>{l.label}</span>
                                    <span className={styles.kcount}>{laneCount}</span>
                                </button>
                            ),
                            ...(folded ? [] : columns.map(c => renderCell(l, c))),
                            ...(!folded && source.fieldsEditable ? [<div key={`pad:${l.key}`} />] : []),
                        ]
                    })}
                </div>
            </div>
            {menu && menuCol && (
                <Popover anchor={menu.anchor} onClose={closeMenu} width={250} label="Column">
                    <ColumnMenu field={column} colKey={menu.colKey} cfg={cfg} onConfig={cfgSet} source={source}
                        isFirst={menu.first} isLast={menu.last} onClose={closeMenu} />
                </Popover>
            )}
            {cards.overlays}
        </div>
    )
}

export default memo(KanbanView)
