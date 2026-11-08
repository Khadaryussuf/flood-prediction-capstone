/** The login and sign-up panel's 3D scene, behind the whole panel: a night city in
 *  depth along a rain-soaked avenue. Four rows of generic towers (not real buildings)
 *  with setbacks, antennas and lit windows; two generic landmarks (a round tower with
 *  a saucer crown, and a slender spire); fog; a cyan glow on the horizon; slowly
 *  blinking red aircraft lights; rain; and a wet street that truly reflects it all,
 *  rippling where drops land.
 *
 *  Loaded only with a dynamic import (useCityScene.ts). Nothing flashes: the only
 *  changing lights are the aircraft lights, pulsing about once every two seconds.
 *  Rendering pauses while the tab is hidden or the canvas is off-screen, and
 *  dispose() releases every GPU resource. */
import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DynamicDrawUsage,
  FogExp2,
  HemisphereLight,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  RepeatWrapping,
  Scene,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector4,
  WebGLRenderer,
  type BufferGeometry,
  type Texture,
} from 'three'
import { Reflector } from 'three/examples/jsm/objects/Reflector.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export interface CitySceneOptions {
  /** The element whose mouse movement adds parallax (the panel) */
  pointerArea?: HTMLElement | null
  /** Called once the first frame is on screen */
  onReady?: () => void
  /** Called if the browser takes the WebGL context away, or the device is too slow
   *  to draw the scene smoothly (the panel then shows the drawn skyline) */
  onLost?: () => void
}

export interface CityScene {
  dispose(): void
}

type Palette = { top: string; mid: string; bottom: string; accent: string; window: string }

const MAX_PIXEL_RATIO = 2
// The camera stands in the avenue, a little above the water, looking up toward the
// skyline so the horizon sits about 78% down the panel: the towers rise on both sides,
// mostly below the words' scrim, with the wet street beneath them.
const CAMERA_HOME = { x: 0.6, y: 2.1, z: 16 }
const LOOK_AT = { x: 0, y: 23, z: -60 }
const AVENUE = 4.2 // half-width of the open avenue down the middle
// Window texture: 8 windows across and 16 floors per tile; one window every
// 0.5 units across and one floor every 0.6 units up
const TILE_W = 4
const TILE_H = 9.6
const RIPPLES = 24
const AIRCRAFT_HZ = 0.5 // well under the 3-per-second photosensitivity limit
// Too slow to look smooth: under this many frames a second over the first seconds
const MIN_FPS = 20
const FPS_WINDOW_S = 3

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
    window: value('--brand-window', '#FCD9A0'),
  }
}

const mix = (a: string, b: string, t: number) => new Color(a).lerp(new Color(b), t)
const hex = (color: Color) => `#${color.getHexString()}`

function canvasTexture(width: number, height: number, draw: (context: CanvasRenderingContext2D) => void): CanvasTexture | null {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return null
  draw(context)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

/** The sky: dark overhead, brightening to the city's cyan glow at the horizon */
function skyTexture(palette: Palette) {
  return canvasTexture(2, 256, (context) => {
    const gradient = context.createLinearGradient(0, 0, 0, 256)
    gradient.addColorStop(0, palette.top)
    gradient.addColorStop(0.42, palette.mid)
    gradient.addColorStop(0.78, hex(mix(palette.bottom, palette.accent, 0.4)))
    gradient.addColorStop(1, palette.bottom)
    context.fillStyle = gradient
    context.fillRect(0, 0, 2, 256)
  })
}

/** One tile of windows: most dark, some lit warm, a few cool. Each window is
 *  inset in its cell, so the cell's corner (where roofs point) is always dark. */
function windowTexture(palette: Palette, random: () => number) {
  const texture = canvasTexture(256, 512, (context) => {
    context.fillStyle = '#000'
    context.fillRect(0, 0, 256, 512)
    for (let row = 0; row < 16; row++) {
      for (let col = 0; col < 8; col++) {
        const roll = random()
        if (roll < 0.27) {
          context.globalAlpha = 0.55 + random() * 0.45
          context.fillStyle = roll < 0.03 ? '#BFE6FF' : palette.window
        } else if (roll < 0.42) {
          context.globalAlpha = 1
          context.fillStyle = '#16232E' // unlit glass, just visible
        } else continue
        context.fillRect(col * 32 + 9, row * 32 + 8, 14, 17)
      }
    }
    context.globalAlpha = 1
  })
  if (texture) {
    texture.wrapS = RepeatWrapping
    texture.wrapT = RepeatWrapping
  }
  return texture
}

/** A soft round glow, for the aircraft lights and the horizon */
function glowTexture() {
  return canvasTexture(64, 64, (context) => {
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32)
    gradient.addColorStop(0, 'rgba(255,255,255,1)')
    gradient.addColorStop(0.25, 'rgba(255,255,255,0.55)')
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
    context.fillStyle = gradient
    context.fillRect(0, 0, 64, 64)
  })
}

/** Points a block's texture coordinates at the window tile: walls get windows to
 *  scale (offset per tower, so towers don't repeat), roofs and plain parts get the
 *  tile's dark corner. */
function fitWindows(geometry: BufferGeometry, span: (nx: number) => number, height: number, offset: [number, number], plain: boolean) {
  const uv = geometry.attributes.uv
  const normal = geometry.attributes.normal
  for (let i = 0; i < uv.count; i++) {
    const nx = normal.getX(i)
    const ny = normal.getY(i)
    if (plain || Math.abs(ny) > 0.5) uv.setXY(i, 0.002, 0.002)
    else uv.setXY(i, offset[0] + (uv.getX(i) * span(nx)) / TILE_W, offset[1] + (uv.getY(i) * height) / TILE_H)
  }
}

/** The ground's shader: a real reflection (from three's Reflector) of the city, the
 *  glow and the rain, darkened like wet asphalt, more mirror-like at a low angle,
 *  disturbed by steady drizzle and by rings where drops land, and fogged with distance. */
const GROUND_SHADER = {
  name: 'FloodWatchWetStreet',
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    uTime: { value: 0 },
    uRipples: { value: Array.from({ length: RIPPLES }, () => new Vector4(0, 0, -99, 0)) },
    uBase: { value: new Color('#06121A') },
    uFog: { value: new Color('#0E4A60') },
    uAccent: { value: new Color('#67E8F9') },
    uFogDensity: { value: 0.016 },
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying vec3 vWorld;
    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      vec4 world = modelMatrix * vec4(position, 1.0);
      vWorld = world.xyz;
      gl_Position = projectionMatrix * viewMatrix * world;
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec4 uRipples[${RIPPLES}];
    uniform vec3 uBase;
    uniform vec3 uFog;
    uniform vec3 uAccent;
    uniform float uFogDensity;
    varying vec4 vUv;
    varying vec3 vWorld;
    void main() {
      vec2 p = vWorld.xz;
      vec2 offset = vec2(
        sin(p.y * 1.7 + uTime * 1.3) * 0.0016 + sin(p.x * 2.3 + p.y * 0.7 - uTime * 0.9) * 0.001,
        sin(p.x * 1.9 - uTime * 1.1) * 0.0008);
      float rings = 0.0;
      for (int i = 0; i < ${RIPPLES}; i++) {
        vec4 r = uRipples[i];
        float age = uTime - r.z;
        if (age < 0.0 || age > 1.4) continue;
        vec2 dv = p - r.xy;
        float d = length(dv);
        float band = exp(-pow((d - age * 0.9) * 8.0, 2.0)) * (1.0 - age / 1.4);
        offset += (dv / max(d, 0.001)) * band * 0.01;
        rings += band;
      }
      vec4 uv = vUv;
      uv.xy += offset * uv.w;
      vec3 reflection = texture2DProj(tDiffuse, uv).rgb;
      vec3 toCamera = normalize(cameraPosition - vWorld);
      float mirror = 0.45 + 0.5 * pow(1.0 - max(toCamera.y, 0.0), 4.0);
      vec3 colour = mix(uBase, reflection, mirror) + uAccent * rings * 0.3;
      float dist = length(cameraPosition - vWorld);
      float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
      gl_FragColor = vec4(mix(colour, uFog, fog), 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
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
  const pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO)
  renderer.setPixelRatio(pixelRatio)
  const scene = new Scene()
  const camera = new PerspectiveCamera(55, 1, 0.1, 400)
  const fog = new FogExp2(mix(palette.bottom, palette.accent, 0.18), 0.016)
  scene.fog = fog

  const hemisphere = new HemisphereLight(mix(palette.mid, palette.accent, 0.45), new Color(palette.top), 1.0)
  const moon = new DirectionalLight(new Color('#9FB7D6'), 0.7)
  moon.position.set(-20, 30, 25)
  const rim = new DirectionalLight(new Color(palette.accent), 1.1) // the glow, catching edges
  rim.position.set(10, 8, -80)
  scene.add(hemisphere, moon, rim)

  // ---- The city: every block merged into one mesh, windows from one texture ----
  const blocks: BufferGeometry[] = []
  const antennaTops: { x: number; y: number; z: number }[] = []
  const offset = (): [number, number] => [Math.floor(random() * 8) / 8, Math.floor(random() * 16) / 16]
  function box(x: number, base: number, z: number, width: number, height: number, depth: number, plain = false) {
    const geometry = new BoxGeometry(width, height, depth)
    fitWindows(geometry, (nx) => (Math.abs(nx) > 0.5 ? depth : width), height, offset(), plain)
    geometry.translate(x, base + height / 2, z)
    blocks.push(geometry)
  }
  function drum(x: number, base: number, z: number, radiusTop: number, radiusBottom: number, height: number, plain = false) {
    const geometry = new CylinderGeometry(radiusTop, radiusBottom, height, 24)
    fitWindows(geometry, () => 2 * Math.PI * radiusBottom, height, offset(), plain)
    geometry.translate(x, base + height / 2, z)
    blocks.push(geometry)
  }
  function antenna(x: number, base: number, z: number, height: number) {
    box(x, base, z, 0.12, height, 0.12, true)
    antennaTops.push({ x, y: base + height + 0.1, z })
  }
  /** A tower with up to two setbacks, and now and then an antenna */
  function tower(x: number, z: number, width: number, depth: number, height: number) {
    box(x, 0, z, width, height, depth)
    let top = height
    if (height > 9 && random() < 0.55) {
      const h = height * (0.18 + random() * 0.2)
      box(x, top, z, width * 0.7, h, depth * 0.7)
      top += h
      if (random() < 0.4) {
        const h2 = h * 0.6
        box(x, top, z, width * 0.45, h2, depth * 0.45)
        top += h2
      }
    }
    if (height > 12 && random() < 0.35) antenna(x, top, z, 2 + random() * 3)
  }

  // Four rows, nearer to farther, lower to taller; the avenue stays open down the middle
  const rows = [
    { near: -7, far: -18, min: 4, max: 12 },
    { near: -22, far: -36, min: 6, max: 17 },
    { near: -40, far: -60, min: 8, max: 24 },
    { near: -66, far: -100, min: 10, max: 32 },
  ]
  rows.forEach((row, index) => {
    for (let z = row.near; z > row.far; z -= 4 + random() * 2) {
      for (let x = -46; x < 46; x += 3 + random() * 2.2) {
        if (index < 3 && Math.abs(x) < AVENUE + 1.2) continue
        if (random() < 0.18) continue
        const width = 2 + random() * 2
        const depth = 2 + random() * 2
        const height = row.min + random() ** 1.6 * (row.max - row.min)
        tower(x + random() * 0.8, z - random() * 1.5, width, depth, height)
      }
    }
  })
  // Landmark one: a round tower with a saucer crown and a short mast
  drum(12, 0, -42, 2.2, 2.2, 19)
  drum(12, 19, -42, 3.5, 2.2, 1.1, true)
  drum(12, 20.1, -42, 3.7, 3.7, 0.18, true)
  drum(12, 20.28, -42, 0.7, 0.7, 1.4, true)
  antenna(12, 21.7, -42, 3)
  // Landmark two: a slender spire at the end of the avenue
  box(-2, 0, -84, 4.2, 26, 4.2)
  box(-2, 26, -84, 3.2, 9, 3.2)
  box(-2, 35, -84, 2.1, 6, 2.1)
  antenna(-2, 41, -84, 8)

  const cityGeometry = track(mergeGeometries(blocks))
  for (const block of blocks) block.dispose()
  const windows = windowTexture(palette, seeded(5))
  if (windows) track(windows)
  const cityMaterial = track(new MeshLambertMaterial({
    color: 0xffffff,
    emissive: new Color(0xffffff),
    emissiveMap: windows,
    emissiveIntensity: 1.5,
  }))
  scene.add(new Mesh(cityGeometry, cityMaterial))

  // The spire's lantern: a steady cyan band of light near its top
  const lanternGeometry = track(new BoxGeometry(2.2, 0.5, 2.2))
  const lanternMaterial = track(new MeshBasicMaterial({ color: new Color(palette.accent) }))
  const lantern = new Mesh(lanternGeometry, lanternMaterial)
  lantern.position.set(-2, 40.4, -84)
  scene.add(lantern)

  // ---- The horizon glow, a real object so the street reflects it ----
  const glow = glowTexture()
  if (glow) track(glow)
  const horizonGeometry = track(new PlaneGeometry(420, 70))
  const horizonMaterial = track(new MeshBasicMaterial({
    color: new Color(palette.accent), map: glow, transparent: true, opacity: 0.55,
    blending: AdditiveBlending, depthWrite: false, fog: false,
  }))
  const horizon = new Mesh(horizonGeometry, horizonMaterial)
  horizon.position.set(0, 0, -130)
  scene.add(horizon)

  // ---- Aircraft lights: small red glows on the masts, pulsing slowly, out of step ----
  const aircraft = antennaTops.map((spot, i) => {
    const material = track(new SpriteMaterial({ color: new Color('#FF3B30'), map: glow, transparent: true, blending: AdditiveBlending, depthWrite: false }))
    const sprite = new Sprite(material)
    sprite.position.set(spot.x, spot.y, spot.z)
    const size = 0.9 + Math.max(0, -spot.z) * 0.02
    sprite.scale.set(size, size, size)
    scene.add(sprite)
    return { material, phase: (i * 0.37) % 1 }
  })

  // ---- The wet street: a real reflection, rippled ----
  const groundGeometry = track(new PlaneGeometry(320, 320))
  const ground = track(new Reflector(groundGeometry, {
    shader: GROUND_SHADER,
    clipBias: 0.003,
    textureWidth: 512,
    textureHeight: 512,
    multisample: 0,
  }))
  ground.rotation.set(-Math.PI / 2, 0, 0)
  ground.position.set(0, 0, -120)
  scene.add(ground)
  // The material's own copy of the uniforms above, with the same shape
  const groundUniforms = ground.material.uniforms as unknown as typeof GROUND_SHADER.uniforms
  let nextRipple = 0
  let lastRipple = 0

  // ---- Rain: thin streaks nearer and farther than the towers ----
  const RAIN_COUNT = 1600
  const rainGeometry = track(new PlaneGeometry(0.02, 0.85))
  const rainMaterial = track(new MeshBasicMaterial({ color: new Color(palette.accent), transparent: true, opacity: 0.32, blending: AdditiveBlending, depthWrite: false }))
  const rain = track(new InstancedMesh(rainGeometry, rainMaterial, RAIN_COUNT))
  rain.instanceMatrix.setUsage(DynamicDrawUsage)
  const drops = Array.from({ length: RAIN_COUNT }, () => ({
    x: (random() - 0.5) * 70,
    y: random() * 26,
    z: 12 - random() * 70,
    speed: 12 + random() * 6,
  }))
  scene.add(rain)
  const dummy = new Object3D()

  let background: Texture | null = null
  function applyPalette() {
    palette = readPalette(canvas)
    background?.dispose()
    background = skyTexture(palette)
    scene.background = background ?? new Color(palette.mid)
    const fogColour = mix(palette.bottom, palette.accent, 0.18)
    fog.color.copy(fogColour)
    groundUniforms.uFog.value.copy(fogColour)
    groundUniforms.uAccent.value.set(palette.accent)
    groundUniforms.uBase.value.copy(mix(palette.top, '#000000', 0.45))
    cityMaterial.color.copy(mix(palette.mid, '#9DB3CB', 0.42))
    rainMaterial.color.set(palette.accent)
    horizonMaterial.color.set(palette.accent)
    lanternMaterial.color.set(palette.accent)
    rim.color.set(palette.accent)
  }
  applyPalette()

  // ---- The camera drifts forward and back, sways, and leans with a mouse ----
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
    camera.updateProjectionMatrix()
    // The reflection at half the screen's resolution: sharp enough under the ripples
    ground.getRenderTarget().setSize(Math.round(width * pixelRatio * 0.5), Math.round(height * pixelRatio * 0.5))
  }

  let time = 0
  let last = 0
  const tint = new Color()
  function update(dt: number) {
    time += dt
    eased.x += (pointer.x - eased.x) * Math.min(1, dt * 2)
    eased.y += (pointer.y - eased.y) * Math.min(1, dt * 2)
    const forward = (1 - Math.cos(time * 0.028)) * 2.6 // up to 5 units in, and back, over about 4 minutes
    camera.position.set(
      CAMERA_HOME.x + Math.sin(time * 0.07) * 0.9 + eased.x * 1.6,
      CAMERA_HOME.y + Math.sin(time * 0.11) * 0.12 - eased.y * 0.4,
      CAMERA_HOME.z - forward,
    )
    camera.lookAt(LOOK_AT.x + eased.x * 2.5, LOOK_AT.y - eased.y * 1.5, LOOK_AT.z)
    camera.rotation.z += Math.sin(time * 0.05) * 0.008 // a slow sway

    for (let i = 0; i < RAIN_COUNT; i++) {
      const drop = drops[i]
      drop.y -= drop.speed * dt
      if (drop.y <= 0) {
        // A ring on the water, now and then, near enough to see
        if (time - lastRipple > 0.07 && drop.z > -45 && Math.abs(drop.x) < 22) {
          groundUniforms.uRipples.value[nextRipple].set(drop.x, drop.z, time, 0)
          nextRipple = (nextRipple + 1) % RIPPLES
          lastRipple = time
        }
        drop.y += 26
        drop.x = (random() - 0.5) * 70
      }
      dummy.position.set(drop.x, drop.y, drop.z)
      dummy.rotation.set(0, 0, 0.05)
      dummy.updateMatrix()
      rain.setMatrixAt(i, dummy.matrix)
    }
    rain.instanceMatrix.needsUpdate = true
    groundUniforms.uTime.value = time

    // Smooth pulses, never a flash
    for (const light of aircraft) {
      const pulse = 0.5 + 0.5 * Math.sin(2 * Math.PI * (AIRCRAFT_HZ * time + light.phase))
      light.material.color.copy(tint.set('#FF3B30').multiplyScalar(0.25 + 0.75 * pulse))
    }
  }

  let frame = 0
  let visible = !document.hidden
  let onScreen = true
  let ready = false
  // Frames drawn and time spent running, to give up on devices that can't keep up
  let measuredFrames = 0
  let measuredTime = 0
  let gaveUp = false
  function loop(now: number) {
    const elapsed = last ? (now - last) / 1000 : 0
    const dt = Math.min(0.05, elapsed)
    last = now
    update(dt)
    renderer.render(scene, camera)
    if (!ready) {
      ready = true
      options.onReady?.()
    }
    if (!gaveUp && measuredTime < FPS_WINDOW_S) {
      measuredFrames++
      measuredTime += Math.min(elapsed, 0.5) // a long gap is a pause, not slowness
      if (measuredTime >= FPS_WINDOW_S && measuredFrames / measuredTime < MIN_FPS) {
        gaveUp = true
        frame = 0
        options.onLost?.()
        return
      }
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
