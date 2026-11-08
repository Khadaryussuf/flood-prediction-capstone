// Hand-written types for the small part of three.js that src/pages/brand/CityScene.ts
// uses. three ships no types of its own, and @types/three would add seven packages;
// these follow three 0.186's documented API. Extend them if the scene uses more.
declare module 'three' {
  export const AdditiveBlending: number
  export const DynamicDrawUsage: number
  export const SRGBColorSpace: string

  export class Color {
    constructor(value?: string | number | Color)
    copy(color: Color): this
    set(value: string | number | Color): this
    lerp(color: Color, alpha: number): this
    multiplyScalar(scalar: number): this
    getHexString(): string
  }

  export class Vector3 {
    x: number
    y: number
    z: number
    set(x: number, y: number, z: number): this
  }

  export class Euler {
    set(x: number, y: number, z: number): this
  }

  export class Matrix4 {}

  export class Object3D {
    position: Vector3
    rotation: Euler
    scale: Vector3
    matrix: Matrix4
    renderOrder: number
    add(...objects: Object3D[]): this
    clear(): this
    updateMatrix(): void
    lookAt(x: number, y: number, z: number): void
  }

  export class Group extends Object3D {}

  export class Texture {
    colorSpace: string
    dispose(): void
  }
  export class CanvasTexture extends Texture {
    constructor(canvas: HTMLCanvasElement)
  }

  export class BufferGeometry {
    rotateX(angle: number): this
    dispose(): void
  }
  export class PlaneGeometry extends BufferGeometry {
    constructor(width?: number, height?: number)
  }
  export class RingGeometry extends BufferGeometry {
    constructor(innerRadius?: number, outerRadius?: number, thetaSegments?: number)
  }
  export class Shape {
    moveTo(x: number, y: number): this
    lineTo(x: number, y: number): this
  }
  export class ExtrudeGeometry extends BufferGeometry {
    constructor(shape: Shape, options?: { depth?: number; bevelEnabled?: boolean })
  }

  interface MaterialOptions {
    color?: string | number | Color
    transparent?: boolean
    opacity?: number
    blending?: number
    depthWrite?: boolean
  }
  export class Material {
    dispose(): void
  }
  export class MeshBasicMaterial extends Material {
    constructor(options?: MaterialOptions)
    color: Color
  }
  export class MeshLambertMaterial extends Material {
    constructor(options?: MaterialOptions)
    color: Color
  }

  export class Mesh extends Object3D {
    constructor(geometry: BufferGeometry, material: Material)
  }
  export class BufferAttribute {
    needsUpdate: boolean
    setUsage(usage: number): this
  }
  export class InstancedMesh extends Mesh {
    constructor(geometry: BufferGeometry, material: Material, count: number)
    count: number
    instanceMatrix: BufferAttribute
    instanceColor: BufferAttribute | null
    setMatrixAt(index: number, matrix: Matrix4): void
    setColorAt(index: number, color: Color): void
    dispose(): this
  }

  export class Light extends Object3D {}
  export class HemisphereLight extends Light {
    constructor(skyColor: Color, groundColor: Color, intensity?: number)
  }
  export class DirectionalLight extends Light {
    constructor(color: Color, intensity?: number)
  }

  export class FogExp2 {
    constructor(color: Color, density?: number)
    color: Color
  }

  export class Scene extends Object3D {
    background: Color | Texture | null
    fog: FogExp2 | null
  }

  export class PerspectiveCamera extends Object3D {
    constructor(fov?: number, aspect?: number, near?: number, far?: number)
    aspect: number
    updateProjectionMatrix(): void
    setViewOffset(fullWidth: number, fullHeight: number, x: number, y: number, width: number, height: number): void
    clearViewOffset(): void
  }

  export class WebGLRenderer {
    constructor(parameters?: { canvas?: HTMLCanvasElement; antialias?: boolean; powerPreference?: string })
    setPixelRatio(ratio: number): void
    setSize(width: number, height: number, updateStyle?: boolean): void
    render(scene: Scene, camera: PerspectiveCamera): void
    dispose(): void
    forceContextLoss(): void
  }
}
