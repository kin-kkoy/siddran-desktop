import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { LuPlus, LuPalette, LuArrowDown, LuArrowRight } from 'react-icons/lu'
import styles from '../Board.module.css'
import t from '../Table.module.css'
import Popover from '../Popover'
import Card, { AddCard } from './board/Card'
import { ViewBar, CardStyleBar } from './board/cardView'
import { useCards } from './board/useCards'
import { ViewSettings, CellMenu } from './board/BoardMenus'
import { useCardDrag } from './board/useCardDrag'
import { useViewRows } from './board/useViewRows'
import { matrixSetup, matrixLayout, cellKey, cardFields, applyCardStyle, cardLook, primaryField, dropPatch, dropBefore, selectFields, MATRIX_FIELDS_MAX, MATRIX_MAX, NONE } from '../boards'
import { orderRecords } from '../layout'
import * as F from '../fields'
import { MATRIX_FIELDS, MATRIX_CELLS } from '../formats'

/**
 * The Matrix view (spec §13.7): two select fields make the rows and columns
 * (the first six options of each), each record a card in its cell. Dragging a
 * card to another cell sets both fields at once — one undo step (R13.50);
 * within a cell it sets the record's order. Cells can be named and coloured
 * (view settings, R13.52: payload.matrix.cells). Records missing a value wait
 * in the "Not placed" tray below; dragging one out of a cell into the tray
 * clears both values.
 */

/** A cell's name, edited in place: Enter or leaving saves, Esc cancels. */
function NameInput({ value, onDone }) {
    return (
        <input className={styles.mlabelInput} defaultValue={value} autoFocus placeholder="Name this cell" aria-label="Cell name"
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && /^[zy]$/i.test(e.key)) return
                e.stopPropagation()
                if (e.key === 'Enter') { e.preventDefault(); onDone(e.currentTarget.value) }
                if (e.key === 'Escape') { e.preventDefault(); onDone(null) }
            }}
            onBlur={(e) => onDone(e.currentTarget.value)} />
    )
}

const STACK = 8   // cards shown in a cell before "+N more"
const TRAY = 'tray'

function MatrixView({ source, item, onConfig }) {
    const cfg = useMemo(() => item?.payload?.matrix || {}, [item?.payload?.matrix])
    const { t: rows, keepNew, stale, sorted } = useViewRows(source, cfg)
    const fields = source.fields
    const setup = matrixSetup(fields, cfg)
    const { row, col } = setup
    const primary = primaryField(fields)
    const lay = useMemo(() => matrixLayout(rows.rows, setup), [rows.rows, setup.row, setup.col])   // eslint-disable-line react-hooks/exhaustive-deps
    const shown = cardFields(fields, cfg, { exclude: [primary?.id, row?.id, col?.id], max: MATRIX_FIELDS_MAX })
    const size = cfg.size || 'default'

    const rootRef = useRef(null), scrollRef = useRef(null)
    const [open, setOpen] = useState(() => new Set())   // cells showing all their cards
    const [menu, setMenu] = useState(null)              // { key, rk, ck, anchor } — a cell's colour
    const [naming, setNaming] = useState(null)          // the cell whose name is being edited
    const [adding, setAdding] = useState(null)          // the cell (or the tray) with its add box open
    const closeMenu = useCallback(() => setMenu(null), [])
    const cfgSet = useCallback((fn) => onConfig?.(fn), [onConfig])

    const order = useMemo(() => {
        const out = []
        for (const a of lay.rows) for (const b of lay.cols) for (const r of lay.cells.get(cellKey(a, b)) || []) out.push(r.id)
        for (const r of lay.tray) out.push(r.id)
        return out
    }, [lay])

    const onDrop = (d) => {
        const rec = rows.all.find(r => r.id === d.rid)
        if (!rec) return
        const [rk, ck] = d.cell === TRAY ? [NONE, NONE] : d.cell.split('\u0001')
        const patch = dropPatch(rec, [[row, rk], [col, ck]])
        const list = d.cell === TRAY ? lay.tray : lay.cells.get(d.cell) || []
        const before = source.canReorder && !sorted
            ? dropBefore(orderRecords(source.records).map(r => r.id), list.map(r => r.id), d.rid, d.over, d.place)
            : undefined
        if (!Object.keys(patch).length && before === undefined) return
        source.moveTo?.(d.rid, patch, before)
    }
    const { drag, down } = useCardDrag({ rootRef, scrollRef, onDrop, onClick: (ev, rid) => cards.api.click(ev, rid) })
    const cards = useCards({ source, primary, all: rows.all, order, rootRef, down, onStyleKey: (k) => applyLook({ [k]: !curLook?.[k] }) })
    // The style bar: the selected card, else every card.
    const curLook = cards.sel ? cardLook(cfg.styles, cards.sel) : cfg.styles?.all || null
    const applyLook = (patch) => cfgSet(c => ({ ...c, styles: applyCardStyle(c.styles, cards.sel, patch) }))

    const setCell = (rk, ck, patch) => cfgSet(c => {
        const cells = { ...(c.cells || {}) }
        const next = { ...(cells[rk]?.[ck] || {}), ...patch }
        for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k]
        cells[rk] = { ...(cells[rk] || {}), [ck]: next }
        if (!Object.keys(next).length) delete cells[rk][ck]
        return { ...c, cells }
    })

    // Own records missing an axis: add the ones still missing (Impact, Effort) in one step, with the usual quadrant names.
    const addAxes = () => source.apply?.(p => {
        let q = p
        const have = selectFields(q.fields || [])
        const need = have.length === 0 ? MATRIX_FIELDS : have.length === 1 ? [MATRIX_FIELDS[1]] : []   // one select already: it's the rows, Effort the columns
        for (const def of need) {
            const r = F.addField(q, def, { id: (q.fields || []).some(f => f.id === def.id) ? F.newFieldId() : def.id })
            if (!r.error) q = r.payload
        }
        const sel = selectFields(q.fields)
        const fresh = need.length === 2
        return { ...q, matrix: { ...(q.matrix || {}), rowBy: sel[0].id, colBy: sel[1].id, ...(fresh ? { cells: JSON.parse(JSON.stringify(MATRIX_CELLS)) } : null) } }
    })

    if (!row || !col) {
        return (
            <div className={styles.view}>
                <div className={styles.setup}>
                    <p>A Matrix places cards by two <b>Select</b> fields, one for its rows and one for its columns{row ? ` — there’s only ${row.name} so far` : ' — there are none yet'}.</p>
                    {source.fieldsEditable && source.apply && (
                        <button className={t.popBtn} onClick={addAxes}><LuPlus size={13} /> {row ? 'Add an Effort field' : 'Add Impact and Effort fields'}</button>
                    )}
                </div>
            </div>
        )
    }

    // Own records only: a linked task can't be given both values as it's made.
    const canAdd = !!source.canAdd && source.type === 'own'
    const addIn = (a, b, text) => {
        const values = primary ? { [primary.id]: text } : {}
        if (a !== NONE) values[row.id] = a
        if (b !== NONE) values[col.id] = b
        keepNew(source.add(values))
    }
    const cardProps = (r) => ({
        rec: r, primary, shown, colorBy: setup.colorBy, size, look: cardLook(cfg.styles, r.id),
        selected: cards.sel === r.id, editing: cards.editing === r.id, editable: !!primary && source.editable.has(primary.id),
        canRemove: source.canRemove, drop: drag?.over === r.id ? drag.place : null, dragging: drag?.rid === r.id,
        stale: !!stale?.has(r.id), api: cards.api,
    })
    const extraRow = (row.options || []).length > MATRIX_MAX, extraCol = (col.options || []).length > MATRIX_MAX
    const trayOver = drag?.cell === TRAY && !drag.over

    return (
        <div ref={rootRef} className={styles.view} tabIndex={0} onKeyDown={cards.onKeyDown}>
            <ViewBar fields={fields} cfg={cfg} onConfig={cfgSet} shown={rows.rows.length} total={rows.total}
                styleBar={<CardStyleBar cur={curLook} selected={!!cards.sel} apply={applyLook} />}
                settings={() => (
                    <ViewSettings kind="matrix" fields={fields} cfg={cfg} setup={setup} primary={primary} onConfig={cfgSet} source={source} />
                )} />
            <div ref={scrollRef} className={styles.mscroll} data-sb-scroll="true"
                onPointerDown={(e) => { if (!e.target.closest('[data-rid]')) cards.setSel(null) }}>
                <div className={styles.mgrid} style={{
                    gridTemplateColumns: `auto repeat(${Math.max(1, lay.cols.length)}, minmax(13em, 1fr))`,
                    gridTemplateRows: `auto repeat(${Math.max(1, lay.rows.length)}, minmax(9em, auto))`,
                }}>
                    {/* The corner names both axes. */}
                    <div className={styles.mcorner} title={`Rows: ${row.name} · Columns: ${col.name}`}>
                        <span><LuArrowDown size="0.9em" /> {row.name}</span>
                        <span>{col.name} <LuArrowRight size="0.9em" /></span>
                    </div>
                    {lay.cols.map(b => <div key={`c:${b}`} className={styles.maxis}>{b}</div>)}
                    {!lay.cols.length && <div className={styles.maxis}><span className={styles.noneLabel}>{col.name} has no options yet</span></div>}
                    {lay.rows.map(a => [
                        <div key={`r:${a}`} className={`${styles.maxis} ${styles.mrowAxis}`}>{a}</div>,
                        ...lay.cols.map(b => {
                            const key = cellKey(a, b)
                            const list = lay.cells.get(key) || []
                            const meta = cfg.cells?.[a]?.[b] || {}
                            const all = open.has(key)
                            const visible = all ? list : list.slice(0, STACK)
                            return (
                                <div key={key} data-cell={key} role="list"
                                    className={[styles.mcell, drag?.cell === key && !drag.over && styles.cellOver, !list.length && styles.mcellEmpty].filter(Boolean).join(' ')}
                                    style={meta.hue != null ? { '--cell-hue': meta.hue } : undefined}>
                                    <div className={styles.mcellHead}>
                                        {naming === key ? (
                                            <NameInput value={meta.label || ''} onDone={(v) => { setNaming(null); if (v != null && v.trim() !== (meta.label || '')) setCell(a, b, { label: v.trim() || undefined }) }} />
                                        ) : (
                                            // An empty name edits on one click, a set one on a double-click (the Table's rule).
                                            <span className={`${styles.mlabel} ${meta.label ? '' : styles.mlabelEmpty}`}
                                                onClick={() => { if (!meta.label) setNaming(key) }} onDoubleClick={() => setNaming(key)}
                                                title={meta.label ? 'Double-click to rename' : 'Click to name this cell'}>
                                                {meta.label || 'Name this cell'}
                                            </span>
                                        )}
                                        <span className={styles.kcount}>{list.length}</span>
                                        <button className={styles.kmenu} disabled={!canAdd} onClick={() => setAdding(key)} title="Add a card here" aria-label="Add a card here"><LuPlus size="1em" /></button>
                                        <button className={styles.kmenu} onClick={(e) => { const anchor = e.currentTarget; setMenu(x => (x?.key === key ? null : { key, rk: a, ck: b, anchor })) }}
                                            title="Cell colour" aria-label="Cell colour"><LuPalette size="0.95em" /></button>
                                    </div>
                                    {visible.map(r => <Card key={r.id} {...cardProps(r)} />)}
                                    {adding === key && <AddCard placeholder="Type a title, Enter" onAdd={(text) => addIn(a, b, text)} onClose={() => setAdding(null)} />}
                                    {list.length > STACK && (
                                        <button className={styles.more} onClick={() => setOpen(s => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n })}>
                                            {all ? 'Show fewer' : `+${list.length - STACK} more`}
                                        </button>
                                    )}
                                </div>
                            )
                        }),
                        ...(!lay.cols.length ? [<div key={`e:${a}`} className={styles.mcell} />] : []),
                    ])}
                </div>
                {(extraRow || extraCol) && (
                    <div className={styles.note}>A Matrix shows the first {MATRIX_MAX} options of each field; cards with later ones wait below.</div>
                )}
                <div data-cell={TRAY} role="list" className={`${styles.tray} ${trayOver ? styles.cellOver : ''}`}>
                    <div className={styles.trayHead}>
                        Not placed <span className={styles.kcount}>{lay.tray.length}</span>
                        <span className={styles.trayHint}>{lay.tray.length ? `Drag a card into a cell to set its ${row.name} and ${col.name}` : 'Every card has a place'}</span>
                    </div>
                    <div className={styles.trayCards}>
                        {lay.tray.map(r => <Card key={r.id} {...cardProps(r)} />)}
                        {adding === TRAY ? (
                            <AddCard placeholder="Type a title, Enter" onAdd={(text) => addIn(NONE, NONE, text)} onClose={() => setAdding(null)} />
                        ) : (
                            <button className={styles.addCard} disabled={!canAdd} onClick={() => setAdding(TRAY)}
                                title={canAdd ? 'Add a card, then drag it into a cell' : 'A linked widget adds tasks from the Table or Kanban'}>
                                <LuPlus size="1em" /> Add a card
                            </button>
                        )}
                    </div>
                </div>
            </div>
            {menu && (
                <Popover anchor={menu.anchor} onClose={closeMenu} width={250} label="Cell">
                    <CellMenu label={cfg.cells?.[menu.rk]?.[menu.ck]?.label} hue={cfg.cells?.[menu.rk]?.[menu.ck]?.hue}
                        onChange={(patch) => setCell(menu.rk, menu.ck, patch)} />
                </Popover>
            )}
            {cards.overlays}
        </div>
    )
}

export default memo(MatrixView)
