import { LuCheck, LuArrowLeft, LuArrowRight, LuEyeOff, LuChevronsLeftRight, LuChevronsRightLeft } from 'react-icons/lu'
import t from '../../Table.module.css'
import styles from '../../Board.module.css'
import { selectFields, cardFields, NONE } from '../../boards'
import { fieldTypeLabel } from '../../fields'

/**
 * The card views' menus: the view's settings (which fields lay it out, what a
 * card shows), a Kanban column's menu and a Matrix cell's. View settings go
 * through `onConfig` (payload.kanban / payload.matrix, one undo step each);
 * option edits through the source's field verbs.
 */

const Head = ({ children }) => <div className={t.popHead}>{children}</div>
const Tick = ({ on }) => <span className={t.popTick}>{on && <LuCheck size={13} />}</span>

function FieldSelect({ label, fields, value, onChange, none }) {
    return (
        <div className={t.popRow}>
            <span className={styles.popLabelWide}>{label}</span>
            <select className={t.popSelect} value={value || ''} aria-label={label} onChange={(e) => onChange(e.target.value || undefined)}>
                {none && <option value="">{none}</option>}
                {fields.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
        </div>
    )
}

/** Commits on Enter or leaving the box; Esc leaves it as it was. */
function CommitInput({ value, onCommit, ...rest }) {
    return (
        <input className={t.popInput} defaultValue={value ?? ''} {...rest}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }}
            onBlur={(e) => { const v = e.currentTarget.value; if (v !== String(value ?? '')) onCommit(v) }} />
    )
}

const SIZES = [['compact', 'Compact'], ['default', 'Default'], ['detailed', 'Detailed']]

/**
 * Settings for a Kanban (`kind: 'kanban'`: columns, swimlanes) or a Matrix
 * (`'matrix'`: rows, columns), and for both what a card shows.
 */
export function ViewSettings({ kind, fields, cfg, setup, primary, onConfig, source, onAddSelect }) {
    const sel = selectFields(fields)
    const max = kind === 'kanban' ? 3 : 2
    const layoutIds = kind === 'kanban' ? [setup.column?.id, setup.lane?.id] : [setup.row?.id, setup.col?.id]
    const shown = cardFields(fields, cfg, { exclude: [primary?.id, ...layoutIds], max })
    const shownIds = new Set(shown.map(f => f.id))
    const choosable = fields.filter(f => f.id !== primary?.id && !layoutIds.includes(f.id))
    const set = (k, v) => onConfig(c => { const n = { ...c }; if (v === undefined) delete n[k]; else n[k] = v; return n })
    const toggleField = (id) => onConfig(c => {
        const cur = cardFields(fields, c, { exclude: [primary?.id, ...layoutIds], max }).map(f => f.id)
        const next = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id].slice(-max)
        return { ...c, cardFields: next }
    })
    return (
        <>
            <Head>Layout</Head>
            {kind === 'kanban' ? (
                <>
                    <FieldSelect label="Columns" fields={sel} value={setup.column?.id} onChange={(v) => set('columnBy', v)} />
                    <FieldSelect label="Swimlanes" fields={sel.filter(f => f.id !== setup.column?.id)} value={setup.lane?.id} none="None" onChange={(v) => set('laneBy', v)} />
                    <label className={t.popRowCheck}>
                        <input type="checkbox" checked={!cfg.hideEmpty} onChange={(e) => set('hideEmpty', e.target.checked ? undefined : true)} />
                        <span>Show the “No {setup.column?.name}” column</span>
                    </label>
                </>
            ) : (
                <>
                    <FieldSelect label="Rows" fields={sel} value={setup.row?.id} onChange={(v) => set('rowBy', v)} />
                    <FieldSelect label="Columns" fields={sel.filter(f => f.id !== setup.row?.id)} value={setup.col?.id} onChange={(v) => set('colBy', v)} />
                </>
            )}
            {source.fieldsEditable && onAddSelect && (
                <button className={t.popItem} onClick={onAddSelect}><span className={t.popTick} />+ New select field</button>
            )}
            <Head>Cards</Head>
            <FieldSelect label="Colour by" fields={sel} value={setup.colorBy?.id} none="None" onChange={(v) => set('colorBy', v)} />
            <div className={t.popRow}>
                <span className={styles.popLabelWide}>Size</span>
                <span className={styles.segs}>
                    {SIZES.map(([id, label]) => (
                        <button key={id} className={`${styles.seg} ${(cfg.size || 'default') === id ? styles.segOn : ''}`}
                            onClick={() => set('size', id === 'default' ? undefined : id)}>{label}</button>
                    ))}
                </span>
            </div>
            <div className={t.popEmpty}>Show up to {max} fields under the title:</div>
            {choosable.map(f => (
                <button key={f.id} className={t.popItem} onClick={() => toggleField(f.id)}>
                    <Tick on={shownIds.has(f.id)} /> <span className={t.popLabel}>{f.name}</span> <span className={t.popMeta}>{fieldTypeLabel(f.type)}</span>
                </button>
            ))}
        </>
    )
}

/** A Kanban column's menu: collapse, a WIP limit, and for an option column (own records) rename and move. */
export function ColumnMenu({ field, colKey, cfg, onConfig, source, isFirst, isLast, onClose }) {
    const option = colKey !== NONE
    const own = !!source.fieldsEditable
    const collapsed = (cfg.collapsed || []).includes(colKey)
    const wip = cfg.wip?.[colKey]
    const setWip = (raw) => onConfig(c => {
        const n = Math.round(Number(String(raw).trim()))
        const next = { ...(c.wip || {}) }
        if (!String(raw).trim() || !(n > 0)) delete next[colKey]; else next[colKey] = n
        return { ...c, wip: next }
    })
    const neighbour = (d) => { const o = field.options || []; return o[o.indexOf(colKey) + d] }
    return (
        <>
            <Head>{option ? colKey : `No ${field.name}`}</Head>
            {option && own && (
                <div className={t.popRow}>
                    <CommitInput value={colKey} aria-label="Column name" placeholder="Name"
                        onCommit={(v) => { if (v.trim()) { source.renameOption(field.id, colKey, v.trim()); onClose() } }} />
                </div>
            )}
            <button className={t.popItem} onClick={() => { onConfig(c => ({ ...c, collapsed: collapsed ? (c.collapsed || []).filter(k => k !== colKey) : [...(c.collapsed || []), colKey] })); onClose() }}>
                {collapsed ? <LuChevronsLeftRight size={14} /> : <LuChevronsRightLeft size={14} />} {collapsed ? 'Expand' : 'Collapse'}
            </button>
            <div className={t.popRow}>
                <span className={styles.popLabelWide}>Card limit</span>
                <CommitInput value={wip ?? ''} placeholder="None" inputMode="numeric" aria-label="Card limit" onCommit={setWip} />
            </div>
            {option && own && (
                <>
                    <button className={t.popItem} disabled={isFirst} onClick={() => source.moveOption(field.id, colKey, neighbour(-1))}><LuArrowLeft size={14} /> Move left</button>
                    <button className={t.popItem} disabled={isLast} onClick={() => source.moveOption(field.id, colKey, neighbour(1))}><LuArrowRight size={14} /> Move right</button>
                    <div className={t.popNote}>Moving changes {field.name}’s option order in every view.</div>
                </>
            )}
            {!option && (
                <button className={t.popItem} onClick={() => { onConfig(c => ({ ...c, hideEmpty: true })); onClose() }}><LuEyeOff size={14} /> Hide this column</button>
            )}
        </>
    )
}

const CELL_HUES = [null, 0, 25, 45, 140, 175, 210, 265, 310]

/** A Matrix cell's name and colour (view settings, R13.52). */
export function CellMenu({ label, hue, onChange }) {
    return (
        <>
            <Head>Cell</Head>
            <div className={t.popRow}>
                <CommitInput value={label || ''} placeholder="Name this cell" aria-label="Cell name" autoFocus onCommit={(v) => onChange({ label: v.trim() || undefined })} />
            </div>
            <div className={styles.hues}>
                {CELL_HUES.map(h => (
                    <button key={h ?? 'none'} className={`${styles.hue} ${hue === h || (h == null && hue == null) ? styles.hueOn : ''}`}
                        style={h == null ? undefined : { '--hue': h }} onClick={() => onChange({ hue: h ?? undefined })}
                        title={h == null ? 'No colour' : 'Colour'} aria-label={h == null ? 'No colour' : `Hue ${h}`} />
                ))}
            </div>
        </>
    )
}
