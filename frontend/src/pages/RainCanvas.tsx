import { useEffect, useRef, type RefObject } from 'react'

/** Rain over the brand panel, drawn on a canvas.
 *
 *  Streaks fall in front of the skyline and land in the strip of water along its
 *  foot, where they leave small ripples. With a mouse, streaks near the cursor bend
 *  away from it; on touch screens the rain is lighter and sways gently instead.
 *  The loop pauses while the tab is hidden, and nothing is drawn at all for anyone
 *  who asks for reduced motion (the page doesn't depend on it). Decoration only. */

type Drop = { x: number; y: number; speed: number; length: number; land: number; bend: number }
type Ripple = { x: number; y: number; r: number; life: number }

const CURSOR_RADIUS = 130
const MAX_BEND = 46
// The skyline SVG's water strip: from y=186 down to its 200-unit-high viewBox bottom
const WATER_UNITS = 14
const VIEW_W = 400
const VIEW_H = 200

export function RainCanvas({ skyline, className }: { skyline: RefObject<SVGSVGElement | null>; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const element = canvasRef.current
    if (!element || typeof window.matchMedia !== 'function') return
    const canvas: HTMLCanvasElement = element
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')
    const coarse = window.matchMedia('(hover: none), (pointer: coarse)')
    const context = canvas.getContext('2d')
    if (!context) return
    const ctx = context

    let width = 0
    let height = 0
    let waterTop = 0
    let drops: Drop[] = []
    let ripples: Ripple[] = []
    let frame = 0
    let last = 0
    let time = 0
    const cursor = { x: -9999, y: -9999, active: false }
    const accent = () => getComputedStyle(canvas).getPropertyValue('--brand-accent').trim() || '#67E8F9'
    let colour = accent()

    const landing = () => waterTop + Math.random() * Math.max(4, height - waterTop - 2)
    const newDrop = (anywhere: boolean): Drop => ({
      x: Math.random() * (width + 60) - 30,
      y: anywhere ? Math.random() * height : -20 - Math.random() * 80,
      speed: (coarse.matches ? 260 : 380) + Math.random() * 260,
      length: 10 + Math.random() * 14,
      land: landing(),
      bend: 0,
    })

    function measure() {
      const box = canvas.getBoundingClientRect()
      width = box.width
      height = box.height
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(width * ratio)
      canvas.height = Math.round(height * ratio)
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
      // Where the water starts, from the skyline's box (it is drawn "slice", bottom-aligned)
      const svg = skyline.current?.getBoundingClientRect()
      if (svg && svg.height) {
        const scale = Math.max(svg.width / VIEW_W, svg.height / VIEW_H)
        waterTop = svg.bottom - box.top - WATER_UNITS * scale
      } else {
        waterTop = height - 12
      }
      const count = Math.min(170, Math.round((width * height) / (coarse.matches ? 14000 : 7000)))
      drops = Array.from({ length: count }, () => newDrop(true))
      ripples = []
      colour = accent()
    }

    function step(now: number) {
      const dt = Math.min(0.05, (now - (last || now)) / 1000)
      last = now
      time += dt
      ctx.clearRect(0, 0, width, height)
      ctx.strokeStyle = colour
      ctx.lineCap = 'round'
      const sway = coarse.matches ? Math.sin(time * 0.4) * 6 : 0
      for (const drop of drops) {
        drop.y += drop.speed * dt
        // Bend away from the cursor, easing in and out so streaks don't snap
        let target = 0
        if (cursor.active) {
          const dx = drop.x - cursor.x
          const dy = drop.y - cursor.y
          const distance = Math.hypot(dx, dy)
          if (distance < CURSOR_RADIUS) target = Math.sign(dx || 1) * MAX_BEND * (1 - distance / CURSOR_RADIUS) ** 2
        }
        drop.bend += (target - drop.bend) * Math.min(1, dt * 10)
        const headX = drop.x + drop.bend + sway
        if (drop.y >= drop.land) {
          if (ripples.length < 90) ripples.push({ x: headX, y: drop.land, r: 1, life: 1 })
          Object.assign(drop, newDrop(false))
          continue
        }
        // Fainter high in the sky, where the words are; stronger near the city
        ctx.globalAlpha = 0.1 + 0.4 * Math.max(0, Math.min(1, drop.y / height))
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(drop.x + sway * 0.6 - 2, drop.y - drop.length)
        ctx.quadraticCurveTo(drop.x + drop.bend * 0.4 + sway * 0.8, drop.y - drop.length * 0.4, headX, drop.y)
        ctx.stroke()
      }
      ctx.lineWidth = 1
      ripples = ripples.filter((ripple) => {
        ripple.r += dt * 16
        ripple.life -= dt * 1.6
        if (ripple.life <= 0) return false
        ctx.globalAlpha = ripple.life * 0.55
        ctx.beginPath()
        ctx.ellipse(ripple.x, ripple.y, ripple.r, ripple.r * 0.3, 0, 0, Math.PI * 2)
        ctx.stroke()
        return true
      })
      ctx.globalAlpha = 1
      frame = requestAnimationFrame(step)
    }

    const running = () => frame !== 0
    function start() {
      if (running() || reduce.matches || document.hidden) return
      last = 0
      frame = requestAnimationFrame(step)
    }
    function stop() {
      cancelAnimationFrame(frame)
      frame = 0
    }
    function sync() {
      if (reduce.matches || document.hidden) {
        stop()
        if (reduce.matches) ctx.clearRect(0, 0, width, height)
      } else {
        start()
      }
    }

    // The cursor is followed over the whole panel, which lies above the canvas
    const panel = canvas.parentElement
    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return
      const box = canvas.getBoundingClientRect()
      cursor.x = event.clientX - box.left
      cursor.y = event.clientY - box.top
      cursor.active = true
    }
    const onLeave = () => { cursor.active = false }
    panel?.addEventListener('pointermove', onMove)
    panel?.addEventListener('pointerleave', onLeave)

    const resize = new ResizeObserver(measure)
    resize.observe(canvas)
    // The theme changes the accent colour
    const theme = new MutationObserver(() => { colour = accent() })
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    document.addEventListener('visibilitychange', sync)
    reduce.addEventListener('change', sync)
    measure()
    sync()

    return () => {
      stop()
      resize.disconnect()
      theme.disconnect()
      document.removeEventListener('visibilitychange', sync)
      reduce.removeEventListener('change', sync)
      panel?.removeEventListener('pointermove', onMove)
      panel?.removeEventListener('pointerleave', onLeave)
    }
  }, [skyline])

  return <canvas ref={canvasRef} className={className} aria-hidden />
}
