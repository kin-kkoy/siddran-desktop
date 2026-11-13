import { describe, it, expect } from 'vitest'
import { frameTitlePx, frameTitleRect, FRAME_TITLE_PX } from './frames'

const frame = (titleSize) => ({ type: 'shape', x: 0, y: 100, w: 400, h: 300, payload: { kind: 'frame', title: 'Plan', ...(titleSize != null ? { titleSize } : {}) } })

describe('frame title size', () => {
    it('defaults to the standard size', () => {
        expect(frameTitlePx(frame())).toBe(FRAME_TITLE_PX)
    })
    it('takes its own size, capped to 10–24', () => {
        expect(frameTitlePx(frame(18))).toBe(18)
        expect(frameTitlePx(frame(40))).toBe(24)
        expect(frameTitlePx(frame(3))).toBe(10)
        expect(frameTitlePx(frame('x'))).toBe(FRAME_TITLE_PX)
    })
    it('a bigger title gets a taller grab strip', () => {
        expect(frameTitleRect(frame(24)).h).toBeGreaterThan(frameTitleRect(frame()).h)
    })
})
