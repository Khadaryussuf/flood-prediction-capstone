/** The login and sign-up panel's 3D scene: a low-poly night city of generic
 *  towers (not real buildings) on a wet, reflective street, with fog, a few warm
 *  windows, a cyan glow on the horizon, and rain falling in front of and behind
 *  the towers that splashes on the ground.
 *
 *  Loaded only with a dynamic import (BrandVisual.tsx), so three.js never weighs
 *  on the rest of the app. Nothing flashes: lights and colours are steady, only
 *  the rain and the slow camera move. Rendering pauses while the tab is hidden or
 *  the canvas is off-screen, and dispose() releases every GPU resource. */
import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  DirectionalLight,
  DynamicDrawUsage,
  ExtrudeGeometry,
  FogExp2,
  Group,
  HemisphereLight,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  RingGeometry,
  Scene,
  Shape,
  SRGBColorSpace,
  WebGLRenderer,
  type BufferGeometry,
  type Texture,
} from 'three'

export interface CitySceneOptions {
  /** The element whose mouse movement adds parallax (the panel) */
  pointerArea?: HTMLElement | null
  /** How far down the canvas (0 to 1) the city may start: the top of the skyline's box,
   *  so the towers never rise behind the words */
  cityTop?: () => number
  /** Called once the first frame is on screen */
  onReady?: () => void
  /** Called if the browser takes the WebGL context away */
  onLost?: () => void
}

export interface CityScene {
  dispose(): void
}

type Palette = { top: string; mid: string; bottom: string; accent: string }

const WINDOW_LIGHT = '#FCD9A0'
const MAX_PIXEL_RATIO = 2
const CAMERA_HOME = { x: 0, y: 1.5, z: 15 }
// Aimed above the city, so the horizon sits low (about 80% down): the towers stay in
// the bottom third, under the words, with the wet street below them
const LOOK_AT = { x: 0, y: 10.6, z: -20 }
// Where the tallest towers reach with that framing, as a share of the height
const CITY_TOP = 0.64

/** The same city on every load */
function seeded(seed: number) {
  let state = seed
  return () => (state = (state * 16807) % 2147483647) / 2147483647
}

function readPalette(element: Element): Palette {
  const css = getComputedStyle(element)
  const value = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback
  return {
    top: value('--brand-sky-top', '#06222F'),
    mid: value('--brand', '#0B3B4F'),
    bottom: value('--brand-sky-bottom', '#0E4A60'),
    accent: value('--brand-accent', '#67E8F9'),
  }
}

const mix = (a: string, b: string, t: number) => new Color(a).lerp(new Color(b), t)

/** The sky behind everything: dark at the top, brightening to a cyan glow at the horizon */
function skyTexture(palette: Palette): Texture | null {
  const canvas = document.createElement('canvas')
  canvas.width = 2
  canvas.height = 256
  const context = canvas.getContext('2d')
  if (!context) return null
  const gradient = context.createLinearGradient(0, 0, 0, 256)
  gradient.addColorStop(0, palette.top)
  gradient.addColorStop(0.5, palette.mid)
  gradient.addColorStop(0.8, `#${mix(palette.bottom, palette.accent, 0.32).getHexString()}`)
  gradient.addColorStop(1, palette.bottom)
  context.fillStyle = gradient
  context.fillRect(0, 0, 2, 256)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

/** Unit footprints, extruded one unit upward: a square, a chamfered tower and an L */
function towerShapes(): Shape[] {
  const square = new Shape()
  square.moveTo(-0.5, -0.5)
  square.lineTo(0.5, -0.5)
  square.lineTo(0.5, 0.5)
  square.lineTo(-0.5, 0.5)
  square.lineTo(-0.5, -0.5)
  const chamfered = new Shape()
  const c = 0.2
  chamfered.moveTo(-0.5 + c, -0.5)
  chamfered.lineTo(0.5 - c, -0.5)
  chamfered.lineTo(0.5, -0.5 + c)
  chamfered.lineTo(0.5, 0.5 - c)
  chamfered.lineTo(0.5 - c, 0.5)
  chamfered.lineTo(-0.5 + c, 0.5)
  chamfered.lineTo(-0.5, 0.5 - c)
  chamfered.lineTo(-0.5, -0.5 + c)
  chamfered.lineTo(-0.5 + c, -0.5)
  const ell = new Shape()
  ell.moveTo(-0.5, -0.5)
  ell.lineTo(0.5, -0.5)
  ell.lineTo(0.5, 0.1)
  ell.lineTo(0, 0.1)
  ell.lineTo(0, 0.5)
  ell.lineTo(-0.5, 0.5)
  ell.lineTo(-0.5, -0.5)
  return [square, chamfered, ell]
}

export function startCityScene(canvas: HTMLCanvasElement, options: CitySceneOptions = {}): CityScene {
  const resources: { dispose(): void }[] = []
  const track = <T extends { dispose(): void }>(thing: T): T => {
    resources.push(thing)
    return thing
  }
  const random = seeded(23)
  let palette = readPalette(canvas)

  const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO))
  const scene = new Scene()
  const camera = new PerspectiveCamera(50, 1, 0.1, 140)
  camera.position.set(CAMERA_HOME.x, CAMERA_HOME.y, CAMERA_HOME.z)
  const fog = new FogExp2(mix(palette.bottom, palette.accent, 0.22), 0.022)
  scene.fog = fog

  scene.add(new HemisphereLight(mix(palette.mid, palette.accent, 0.5), new Color(palette.top), 1.1))
  const key = new DirectionalLight(new Color('#9FB7D6'), 0.9)
  key.position.set(-12, 14, 18)
  scene.add(key)

  // Towers: one instanced mesh per footprint, on a grid of lots with streets between
  const geometries = towerShapes().map((shape) => {
    const geometry = track(new ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false }))
    geometry.rotateX(-Math.PI / 2)
    return geometry as BufferGeometry
  })
  // base: where a block starts (above 0 for a setback on top of a tower)
  type Lot = { x: number; z: number; width: number; depth: number; height: number; shape: number; base: number }
  const lots: Lot[] = []
  for (let z = -10; z > -52; z -= 3.4) {
    const far = Math.min(1, (-z - 10) / 40)
    for (let x = -40; x < 40; x += 2.6 + random() * 1.4) {
      if (random() < 0.28) continue // a street
      const width = 1.3 + random() * 1.3
      lots.push({
        x: x + random() * 0.6,
        z: z - random() * 1.2,
        width,
        depth: 1.3 + random() * 1.2,
        height: 1.2 + random() * 1.8 + far * random() * 5.5,
        shape: random() < 0.6 ? 0 : random() < 0.6 ? 1 : 2,
        base: 0,
      })
    }
  }
  // Setbacks: a narrower block on top of some towers
  for (const lot of lots.slice()) {
    if (lot.height > 3.5 && random() < 0.45) {
      lots.push({ ...lot, width: lot.width * 0.6, depth: lot.depth * 0.6, height: lot.height * 0.35, shape: 0, base: lot.height })
    }
  }
  const towerMaterial = track(new MeshLambertMaterial({ color: 0xffffff }))
  const city = new Group()
  const mirror = new Group()
  mirror.scale.set(1, -1, 1) // the wet street's reflection
  const dummy = new Object3D()
  const towerMeshes: InstancedMesh[] = []
  geometries.forEach((geometry, shape) => {
    const mine = lots.filter((lot) => lot.shape === shape)
    if (!mine.length) return
    for (const group of [city, mirror]) {
      const mesh = track(new InstancedMesh(geometry, towerMaterial, mine.length))
      mine.forEach((lot, i) => {
        dummy.position.set(lot.x, lot.base, lot.z)
        dummy.scale.set(lot.width, lot.height, lot.depth)
        dummy.updateMatrix()
        mesh.setMatrixAt(i, dummy.matrix)
      })
      group.add(mesh)
      towerMeshes.push(mesh)
    }
  })

  // A few warm windows on the faces that look toward the camera
  const windowGeometry = track(new PlaneGeometry(1, 1))
  const windowMaterial = track(new MeshBasicMaterial({ color: new Color(WINDOW_LIGHT) }))
  const windows: { x: number; y: number; z: number }[] = []
  for (const lot of lots) {
    if (lot.base > 0 || random() > 0.7) continue
    const count = 1 + Math.floor(random() * 4)
    for (let i = 0; i < count; i++) {
      windows.push({
        x: lot.x + (random() - 0.5) * lot.width * 0.7,
        y: 0.5 + random() * (lot.height - 0.9),
        z: lot.z + lot.depth / 2 + 0.03,
      })
    }
  }
  for (const group of [city, mirror]) {
    const mesh = track(new InstancedMesh(windowGeometry, windowMaterial, windows.length))
    windows.forEach((spot, i) => {
      dummy.position.set(spot.x, spot.y, spot.z)
      dummy.scale.set(0.16, 0.22, 1)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    })
    group.add(mesh)
  }
  scene.add(city, mirror)

  // The wet street: dark and partly see-through, over the mirrored city
  const groundGeometry = track(new PlaneGeometry(240, 240))
  groundGeometry.rotateX(-Math.PI / 2)
  const groundMaterial = track(new MeshBasicMaterial({ color: new Color(palette.top), transparent: true, opacity: 0.78, depthWrite: false }))
  const ground = new Mesh(groundGeometry, groundMaterial)
  ground.renderOrder = 1
  scene.add(ground)

  // Rain: thin streaks over the whole city, nearer and farther than the towers
  const RAIN_COUNT = 1500
  const rainGeometry = track(new PlaneGeometry(0.018, 0.7))
  const rainMaterial = track(new MeshBasicMaterial({ color: new Color(palette.accent), transparent: true, opacity: 0.3, blending: AdditiveBlending, depthWrite: false }))
  const rain = track(new InstancedMesh(rainGeometry, rainMaterial, RAIN_COUNT))
  rain.instanceMatrix.setUsage(DynamicDrawUsage)
  rain.renderOrder = 3
  const drops = Array.from({ length: RAIN_COUNT }, () => ({
    x: (random() - 0.5) * 60,
    y: random() * 22,
    z: 9 - random() * 46,
    speed: 11 + random() * 6,
  }))
  scene.add(rain)

  // Splashes: small rings that widen and fade where drops land
  const SPLASH_COUNT = 220
  const splashGeometry = track(new RingGeometry(0.7, 1, 18))
  splashGeometry.rotateX(-Math.PI / 2)
  const splashMaterial = track(new MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: AdditiveBlending, depthWrite: false }))
  const splashes = track(new InstancedMesh(splashGeometry, splashMaterial, SPLASH_COUNT))
  splashes.instanceMatrix.setUsage(DynamicDrawUsage)
  splashes.renderOrder = 2
  const splashState = Array.from({ length: SPLASH_COUNT }, () => ({ x: 0, z: 0, life: 0 }))
  const splashColour = new Color()
  let nextSplash = 0
  scene.add(splashes)

  let background: Texture | null = null
  function applyPalette() {
    palette = readPalette(canvas)
    background?.dispose()
    background = skyTexture(palette)
    scene.background = background ?? new Color(palette.mid)
    fog.color.copy(mix(palette.bottom, palette.accent, 0.22))
    rainMaterial.color.set(palette.accent)
    groundMaterial.color.set(palette.top)
    // Each tower a slightly different blue-grey, lighter than the night around it
    const base = mix(palette.mid, '#8FA6BF', 0.3)
    const tint = new Color()
    for (const mesh of towerMeshes) {
      const shade = seeded(mesh.count * 7 + 3)
      for (let i = 0; i < mesh.count; i++) {
        mesh.setColorAt(i, tint.copy(base).multiplyScalar(0.75 + shade() * 0.4))
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }
  applyPalette()

  // The camera drifts slowly; a mouse adds a little parallax. Touch gets the drift only.
  const pointer = { x: 0, y: 0 }
  const eased = { x: 0, y: 0 }
  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return
    const box = (options.pointerArea ?? canvas).getBoundingClientRect()
    pointer.x = ((event.clientX - box.left) / box.width - 0.5) * 2
    pointer.y = ((event.clientY - box.top) / box.height - 0.5) * 2
  }
  const onPointerLeave = () => {
    pointer.x = 0
    pointer.y = 0
  }
  options.pointerArea?.addEventListener('pointermove', onPointerMove)
  options.pointerArea?.addEventListener('pointerleave', onPointerLeave)

  function resize() {
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (!width || !height) return
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    // Shift the picture down (never up) so the towers start at the skyline's box
    const top = options.cityTop?.() ?? CITY_TOP
    const shift = Math.max(0, top + 0.02 - CITY_TOP) * height
    if (shift > 0) camera.setViewOffset(width, height, 0, -shift, width, height)
    else camera.clearViewOffset()
    camera.updateProjectionMatrix()
  }

  let time = 0
  let last = 0
  function update(dt: number) {
    time += dt
    eased.x += (pointer.x - eased.x) * Math.min(1, dt * 2.5)
    eased.y += (pointer.y - eased.y) * Math.min(1, dt * 2.5)
    camera.position.set(
      CAMERA_HOME.x + Math.sin(time * 0.05) * 1.6 + eased.x * 1.3,
      CAMERA_HOME.y + Math.sin(time * 0.083) * 0.12 - eased.y * 0.25,
      CAMERA_HOME.z + Math.sin(time * 0.031) * 0.6,
    )
    camera.lookAt(LOOK_AT.x + eased.x * 0.6, LOOK_AT.y, LOOK_AT.z)

    for (let i = 0; i < RAIN_COUNT; i++) {
      const drop = drops[i]
      drop.y -= drop.speed * dt
      if (drop.y <= 0) {
        if (drop.z > -34) {
          const splash = splashState[nextSplash]
          splash.x = drop.x
          splash.z = drop.z
          splash.life = 1
          nextSplash = (nextSplash + 1) % SPLASH_COUNT
        }
        drop.y += 22
        drop.x = (random() - 0.5) * 60
      }
      dummy.position.set(drop.x, drop.y, drop.z)
      dummy.rotation.set(0, 0, 0.06)
      dummy.scale.set(1, 1, 1)
      dummy.updateMatrix()
      rain.setMatrixAt(i, dummy.matrix)
    }
    rain.instanceMatrix.needsUpdate = true

    const accent = new Color(palette.accent)
    for (let i = 0; i < SPLASH_COUNT; i++) {
      const splash = splashState[i]
      splash.life = Math.max(0, splash.life - dt * 2.4)
      const size = splash.life > 0 ? 0.04 + (1 - splash.life) * 0.32 : 0
      dummy.position.set(splash.x, 0.02, splash.z)
      dummy.rotation.set(0, 0, 0)
      dummy.scale.set(size, size, size)
      dummy.updateMatrix()
      splashes.setMatrixAt(i, dummy.matrix)
      splashes.setColorAt(i, splashColour.copy(accent).multiplyScalar(splash.life * 0.8))
    }
    splashes.instanceMatrix.needsUpdate = true
    if (splashes.instanceColor) splashes.instanceColor.needsUpdate = true
  }

  let frame = 0
  let visible = !document.hidden
  let onScreen = true
  let ready = false
  function loop(now: number) {
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0)
    last = now
    update(dt)
    renderer.render(scene, camera)
    if (!ready) {
      ready = true
      options.onReady?.()
    }
    frame = requestAnimationFrame(loop)
  }
  function sync() {
    const run = visible && onScreen
    if (run && !frame) {
      last = 0
      frame = requestAnimationFrame(loop)
    } else if (!run && frame) {
      cancelAnimationFrame(frame)
      frame = 0
    }
  }

  const onVisibility = () => {
    visible = !document.hidden
    sync()
  }
  document.addEventListener('visibilitychange', onVisibility)
  const sizeWatch = new ResizeObserver(resize)
  sizeWatch.observe(canvas)
  const screenWatch = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting
      sync()
    })
    : null
  screenWatch?.observe(canvas)
  const themeWatch = new MutationObserver(applyPalette)
  themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  const onContextLost = (event: Event) => {
    event.preventDefault()
    cancelAnimationFrame(frame)
    frame = 0
    options.onLost?.()
  }
  canvas.addEventListener('webglcontextlost', onContextLost)

  resize()
  // Fill the sky with rain before the first frame, so it doesn't start empty
  update(0)
  sync()

  return {
    dispose() {
      cancelAnimationFrame(frame)
      frame = 0
      document.removeEventListener('visibilitychange', onVisibility)
      options.pointerArea?.removeEventListener('pointermove', onPointerMove)
      options.pointerArea?.removeEventListener('pointerleave', onPointerLeave)
      canvas.removeEventListener('webglcontextlost', onContextLost)
      sizeWatch.disconnect()
      screenWatch?.disconnect()
      themeWatch.disconnect()
      background?.dispose()
      for (const resource of resources) resource.dispose()
      scene.clear()
      renderer.dispose()
      renderer.forceContextLoss()
    },
  }
}

