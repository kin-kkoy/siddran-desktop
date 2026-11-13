import { useState } from 'react'
import { LuPlay, LuPresentation, LuFrame, LuPlus, LuMonitor } from 'react-icons/lu'
import { isSlide, sizePresets } from './slides'
import { useDisplays } from './useDisplays'
import styles from './SlideButtons.module.css'

/**
 * The slide part of the floating bar (ContextToolbar renders this for
 * selected frames). A plain frame gets "Convert to slide"; a slide gets its
 * size (the displays' resolutions), "New slide after", "Present from here"
 * and "Convert to frame".
 */
export default function SlideButtons({ frames, btnClass, actions }) {
    const [sizeOpen, setSizeOpen] = useState(false)
    const { displays, refresh } = useDisplays()
    const slides = frames.filter(isSlide)
    const allSlides = slides.length === frames.length
    if (!frames.length) return null

    if (!allSlides) {
        const plain = frames.filter(f => !isSlide(f))
        return (
            <button className={btnClass} onClick={() => actions.convert(plain.map(f => f.id))}
                title={plain.length > 1 ? 'Convert these frames to slides' : 'Convert to slide'} aria-label="Convert to slide">
                <LuPresentation size={18} />
            </button>
        )
    }

    const one = slides.length === 1 ? slides[0] : null
    const presets = sizePresets(displays)
    const size = one ? `${Math.round(one.w)}×${Math.round(one.h)}` : 'Size'
    return (
        <>
            <span className={styles.wrap}>
                <button className={`${btnClass} ${styles.sizeBtn}`} onClick={() => { if (!sizeOpen) refresh(); setSizeOpen(o => !o) }}
                    title="Slide size" aria-label="Slide size" aria-expanded={sizeOpen}>
                    <LuMonitor size={16} /><span>{size}</span>
                </button>
                {sizeOpen && (
                    <div className={styles.menu} role="menu" data-slide-size-menu="1">
                        {presets.map(p => {
                            const on = one && Math.round(one.w) === p.w && Math.round(one.h) === p.h
                            return (
                                <button key={p.key} role="menuitem" className={on ? styles.itemOn : styles.item}
                                    onClick={() => { actions.resize(slides.map(s => s.id), { w: p.w, h: p.h }); setSizeOpen(false) }}>
                                    <span>{p.label}</span><span className={styles.res}>{p.w}×{p.h}</span>
                                </button>
                            )
                        })}
                    </div>
                )}
            </span>
            {one && (
                <button className={btnClass} onClick={() => actions.addAfter(one.id)} title="New slide after this one" aria-label="New slide after this one">
                    <LuPlus size={18} />
                </button>
            )}
            {one && (
                <button className={btnClass} onClick={() => actions.present(one.id)} title="Present from this slide (⇧F5)" aria-label="Present from this slide">
                    <LuPlay size={18} />
                </button>
            )}
            <button className={btnClass} onClick={() => actions.convert(slides.map(s => s.id))}
                title={slides.length > 1 ? 'Turn these slides back into frames' : 'Turn back into a frame'} aria-label="Convert to frame">
                <LuFrame size={17} />
            </button>
        </>
    )
}
