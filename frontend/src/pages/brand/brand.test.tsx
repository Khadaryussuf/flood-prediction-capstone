import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthProvider } from '@/lib/auth'
import { LoginPage } from '@/pages/LoginPage'
import { HEADLINE, PHRASES } from './headlineText'

// jsdom has no WebGL. three itself is replaced by fakes that record what is made
// and disposed; the scene module is replaced for the panel tests, and the real one
// runs against the fake three in the last block.
const fake = vi.hoisted(() => {
  const created: { kind: string; disposed: number; lost: number }[] = []
  // A stand-in for anything: every property is another stand-in, every call returns one
  const anything = (): unknown => {
    const target = function () {} as unknown as Record<PropertyKey, unknown>
    const proxy: unknown = new Proxy(target, {
      get(t, key) {
        if (key === 'then') return undefined
        if (key === Symbol.toPrimitive) return () => 0
        if (!(key in t)) t[key] = anything()
        return t[key]
      },
      apply: () => proxy,
    })
    return proxy
  }
  /** A class whose instances record themselves, count dispose calls, and answer
   *  anything else with a stand-in */
  const kind = (name: string) => class {
    kind = name
    disposed = 0
    lost = 0
    constructor() {
      created.push(this)
      return new Proxy(this, {
        get(t, key) {
          if (key in t) return (t as Record<PropertyKey, unknown>)[key]
          const value = anything()
          ;(t as Record<PropertyKey, unknown>)[key] = value
          return value
        },
      })
    }
    dispose() { this.disposed++ }
    forceContextLoss() { this.lost++ }
  }
  return { created, kind }
})

vi.mock('three', () => {
  const kinds = ['WebGLRenderer', 'Scene', 'PerspectiveCamera', 'FogExp2', 'Color', 'CanvasTexture', 'BoxGeometry',
    'CylinderGeometry', 'PlaneGeometry', 'InstancedMesh', 'Mesh', 'MeshBasicMaterial', 'MeshLambertMaterial', 'Object3D',
    'Sprite', 'SpriteMaterial', 'Vector4', 'HemisphereLight', 'DirectionalLight']
  const module: Record<string, unknown> = { AdditiveBlending: 2, DynamicDrawUsage: 35048, RepeatWrapping: 1000, SRGBColorSpace: 'srgb' }
  for (const name of kinds) module[name] = fake.kind(name)
  return module
})
vi.mock('three/examples/jsm/objects/Reflector.js', () => ({ Reflector: fake.kind('Reflector') }))
vi.mock('three/examples/jsm/utils/BufferGeometryUtils.js', () => {
  const Merged = fake.kind('MergedGeometry')
  return { mergeGeometries: () => new Merged() }
})

const scene = vi.hoisted(() => ({ start: vi.fn(), dispose: vi.fn(), real: false }))
vi.mock('./CityScene', async (importOriginal) => {
  const original = await importOriginal<typeof import('./CityScene')>()
  return {
    startCityScene: (...args: Parameters<typeof original.startCityScene>) => {
      if (scene.real) return original.startCityScene(...args)
      scene.start(...args)
      return { dispose: scene.dispose }
    },
  }
})

/** Sets what the browser reports: reduced motion, the width, and whether WebGL works */
function browser({ reduce = false, wide = true, webgl = true }) {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: query.includes('reduce') ? reduce : query.includes('min-width') ? wide : false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((type: string) =>
    webgl && type.startsWith('webgl') ? { getExtension: () => ({ loseContext() {} }) } : null) as never)
}

function serveSession() {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ user: null, csrf_token: 't', providers: { google: true } }))))
}

const renderLogin = () => render(
  <TooltipProvider>
    <MemoryRouter initialEntries={['/login']}>
      <AuthProvider><LoginPage /></AuthProvider>
    </MemoryRouter>
  </TooltipProvider>,
)
const panel = () => screen.getByRole('complementary', { name: 'About FloodWatch' })

beforeEach(() => {
  scene.start.mockReset()
  scene.dispose.mockReset()
  scene.real = false
  fake.created.length = 0
  serveSession()
})

describe('brand panel picture: the 3D city or the drawn fallback', () => {
  it.each([
    ['reduced motion is set', { reduce: true }],
    ['the screen is under 640 px wide', { wide: false }],
    ['WebGL is unavailable', { webgl: false }],
  ])('shows the drawn skyline and never loads the scene when %s', async (_, settings) => {
    browser(settings)
    renderLogin()
    await screen.findByRole('heading', { name: 'Log in' })
    expect(panel()).toHaveAttribute('data-scene', 'css')
    expect(screen.queryByTestId('city-scene')).not.toBeInTheDocument()
    expect(panel().querySelector(':scope > svg')).toBeInTheDocument()
    expect(scene.start).not.toHaveBeenCalled()
  })

  it('runs the scene when it can, switches to it after its first frame, and disposes it on unmount', async () => {
    browser({})
    const { unmount } = renderLogin()
    await vi.waitFor(() => expect(scene.start).toHaveBeenCalledTimes(1))
    const [canvas, options] = scene.start.mock.calls[0]
    expect(canvas).toBe(screen.getByTestId('city-scene'))
    expect(options.pointerArea).toBe(panel())
    expect(panel()).toHaveAttribute('data-scene', 'loading')
    expect(screen.queryByTestId('scene-scrim')).not.toBeInTheDocument()
    act(() => options.onReady())
    expect(panel()).toHaveAttribute('data-scene', '3d')
    // The scene fills the panel; a scrim keeps the words readable over it
    expect(screen.getByTestId('scene-scrim')).toBeInTheDocument()
    // The fallback's box stays, so nothing moves when the picture switches
    expect(panel().querySelector(':scope > svg')).toBeInTheDocument()
    unmount()
    expect(scene.dispose).toHaveBeenCalledTimes(1)
  })

  it('falls back to the drawn skyline if the WebGL context is lost', async () => {
    browser({})
    renderLogin()
    await vi.waitFor(() => expect(scene.start).toHaveBeenCalled())
    act(() => scene.start.mock.calls[0][1].onLost())
    expect(panel()).toHaveAttribute('data-scene', 'css')
    expect(scene.dispose).toHaveBeenCalled()
  })

  it('keeps the form working as before alongside the scene', async () => {
    browser({})
    renderLogin()
    expect(await screen.findByLabelText('Email')).toHaveFocus()
    expect(screen.getByLabelText('Password', { selector: 'input' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Continue with Google' })).toBeInTheDocument()
  })
})

describe('headline', () => {
  afterEach(() => vi.useRealTimers())

  it('gives screen readers the full headline once, and hides the moving letters', async () => {
    browser({ reduce: true })
    renderLogin()
    const heading = screen.getByRole('heading', { name: HEADLINE })
    expect(heading.querySelectorAll(':scope > [aria-hidden="true"]')).toHaveLength(1)
    expect(heading.textContent).toContain('Know when')
    expect(screen.getAllByRole('heading').filter((h) => h.textContent?.includes('Nairobi'))).toHaveLength(1)
  })

  it('cycles the key words when motion is allowed', () => {
    vi.useFakeTimers()
    browser({})
    renderLogin()
    const current = () => screen.getByTestId('headline-cycle').querySelector('[data-state="in"]')?.textContent
    expect(current()).toBe(PHRASES[0])
    act(() => { vi.advanceTimersByTime(4000) })
    expect(current()).toBe(PHRASES[1])
    act(() => { vi.advanceTimersByTime(3200) })
    expect(current()).toBe(PHRASES[2])
  })

  it('keeps the key words still under reduced motion', () => {
    vi.useFakeTimers()
    browser({ reduce: true })
    renderLogin()
    act(() => { vi.advanceTimersByTime(20000) })
    expect(screen.getByTestId('headline-cycle').querySelector('[data-state="in"]')?.textContent).toBe(PHRASES[0])
  })
})

describe('the three.js scene itself (three mocked)', () => {
  /** Runs the scene's frame loop by hand, a frame every `ms` milliseconds */
  async function runFrames(ms: number, seconds: number) {
    scene.real = true
    browser({})
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => frames.push(callback)))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const { startCityScene } = await import('./CityScene')
    const onLost = vi.fn()
    startCityScene(document.createElement('canvas'), { onLost })
    for (let t = 0, i = 0; t <= seconds * 1000 && frames[i]; t += ms, i++) frames[i](t)
    return onLost
  }

  it('gives up (and the panel shows the drawn skyline) on a device too slow to draw it smoothly', async () => {
    expect(await runFrames(100, 4)).toHaveBeenCalledTimes(1) // 10 frames a second
  })

  it('keeps going on a device that draws it smoothly', async () => {
    expect(await runFrames(16, 4)).not.toHaveBeenCalled() // 60 frames a second
  })

  it('draws, pauses while the tab is hidden, and disposes every GPU resource', async () => {
    scene.real = true
    browser({})
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => frames.push(callback)))
    const cancel = vi.fn()
    vi.stubGlobal('cancelAnimationFrame', cancel)
    const { startCityScene } = await import('./CityScene')
    const canvas = document.createElement('canvas')
    const area = document.createElement('div')
    const onReady = vi.fn()
    const city = startCityScene(canvas, { pointerArea: area, onReady })

    expect(frames).toHaveLength(1)
    frames[0](16)
    expect(onReady).toHaveBeenCalledTimes(1)

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(cancel).toHaveBeenCalled()
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })

    city.dispose()
    const gpu = fake.created.filter((thing) => /Geometry|Material|Texture|InstancedMesh|Reflector/.test(thing.kind))
    expect(gpu.length).toBeGreaterThan(10)
    expect(gpu.map((thing) => thing.kind)).toEqual(expect.arrayContaining(['Reflector', 'MergedGeometry', 'BoxGeometry', 'CylinderGeometry', 'SpriteMaterial']))
    expect(gpu.filter((thing) => thing.disposed === 0).map((thing) => thing.kind)).toEqual([])
    const renderer = fake.created.find((thing) => thing.kind === 'WebGLRenderer')!
    expect(renderer.disposed).toBe(1)
    expect(renderer.lost).toBe(1)
  })
})
