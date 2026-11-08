import { useEffect, useRef, useState, type RefObject } from 'react'

import type { CityScene } from './CityScene'

/** Which version of the panel's picture is showing:
 *  css: the drawn skyline with canvas rain (no WebGL, reduced motion, or under 640 px)
 *  loading: the css version, while the 3D scene loads behind it
 *  3d: the three.js city, once its first frame is drawn */
export type SceneMode = 'css' | 'loading' | '3d'

const REDUCE = '(prefers-reduced-motion: reduce)'
const WIDE = '(min-width: 640px)'

/** Whether this browser can draw WebGL at all. The test context is released at once. */
export function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas')
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null
    if (!gl) return false
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return true
  } catch {
    return false
  }
}

/** The 3D scene is for wide screens, with motion allowed and WebGL working */
export function sceneWanted(): boolean {
  if (typeof window.matchMedia !== 'function') return false
  if (window.matchMedia(REDUCE).matches || !window.matchMedia(WIDE).matches) return false
  return webglAvailable()
}

/** Runs the 3D city on the returned canvas when it is wanted, and falls back to
 *  the css version if three.js fails to load or the WebGL context is lost. The
 *  three.js code is a separate chunk, fetched only here. */
export function useCityScene(pointerArea: RefObject<HTMLElement | null>) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [wanted, setWanted] = useState(sceneWanted)
  const [failed, setFailed] = useState(false)
  const [ready, setReady] = useState(false)

  // Turning reduced motion on, or narrowing the window, switches back to the css version
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const queries = [window.matchMedia(REDUCE), window.matchMedia(WIDE)]
    const update = () => setWanted(sceneWanted())
    for (const query of queries) query.addEventListener('change', update)
    return () => { for (const query of queries) query.removeEventListener('change', update) }
  }, [])

  const run = wanted && !failed
  useEffect(() => {
    const canvas = canvasRef.current
    if (!run || !canvas) return
    let scene: CityScene | null = null
    let cancelled = false
    import('./CityScene')
      .then(({ startCityScene }) => {
        if (cancelled) return
        scene = startCityScene(canvas, {
          pointerArea: pointerArea.current,
          onReady: () => setReady(true),
          onLost: () => setFailed(true),
        })
      })
      .catch(() => setFailed(true))
    return () => {
      cancelled = true
      scene?.dispose()
      setReady(false)
    }
  }, [run, pointerArea])

  const mode: SceneMode = !run ? 'css' : ready ? '3d' : 'loading'
  return { mode, canvasRef }
}
