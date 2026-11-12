import { LuPenTool, LuHighlighter, LuWandSparkles, LuEraser, LuLasso } from 'react-icons/lu'
import PrecisionEraserIcon from '../Toolbar/PrecisionEraserIcon'

/** Label, shortcut and icon for each tool in the drawing flyout. */
export const INK_TOOL_META = {
    pen: { label: 'Pen', key: 'P', Icon: LuPenTool },
    highlighter: { label: 'Highlighter', key: 'P P', Icon: LuHighlighter },
    smart: { label: 'Smart drawing — sketch a shape, get a clean one', key: null, Icon: LuWandSparkles },
    eraser: { label: 'Eraser — removes whole strokes', key: 'E', Icon: LuEraser },
    precisionEraser: { label: 'Precision eraser — removes only what it touches', key: 'E E', Icon: PrecisionEraserIcon },
    lasso: { label: 'Lasso select', key: 'G', Icon: LuLasso },
}
