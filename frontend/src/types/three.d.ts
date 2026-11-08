// Hand-written types for the small part of three.js that src/pages/brand/CityScene.ts
// uses. three ships no types of its own, and @types/three would add seven packages;
// these follow three 0.186's documented API. Extend them if the scene uses more.
declare module 'three' {
  export const AdditiveBlending: number
  export const DynamicDrawUsage: number
  export const RepeatWrapping: number
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

  export class Vector4 {
    constructor(x?: number, y?: number, z?: number, w?: number)
    set(x: number, y: number, z: number, w: number): this
  }

  export class Euler {
    x: number
    y: number
    z: number
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
    wrapS: number
    wrapT: number
    dispose(): void
  }
  export class CanvasTexture extends Texture {
    constructor(canvas: HTMLCanvasElement)
  }

  export class BufferAttribute {
    count: number
    needsUpdate: boolean
    getX(index: number): number
    getY(index: number): number
    getZ(index: number): number
    setXY(index: number, x: number, y: number): this
    setUsage(usage: number): this
  }

  export class BufferGeometry {
    attributes: Record<string, BufferAttribute>
    rotateX(angle: number): this
    translate(x: number, y: number, z: number): this
    dispose(): void
  }
  export class BoxGeometry extends BufferGeometry {
    constructor(width?: number, height?: number, depth?: number)
  }
  export class CylinderGeometry extends BufferGeometry {
    constructor(radiusTop?: number, radiusBottom?: number, height?: number, radialSegments?: number)
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
    map?: Texture | null
    transparent?: boolean
    opacity?: number
    blending?: number
    depthWrite?: boolean
    fog?: boolean
  }
  export class Material {
    dispose(): void
  }
  export class MeshBasicMaterial extends Material {
    constructor(options?: MaterialOptions)
    color: Color
  }
  export class MeshLambertMaterial extends Material {
    constructor(options?: MaterialOptions & { emissive?: Color; emissiveMap?: Texture | null; emissiveIntensity?: number })
    color: Color
  }
  export class SpriteMaterial extends Material {
    constructor(options?: MaterialOptions)
    color: Color
  }
  export interface IUniform<T = unknown> {
    value: T
  }
  export class ShaderMaterial extends Material {
    uniforms: Record<string, IUniform>
  }

  export class Mesh<M extends Material = Material> extends Object3D {
    constructor(geometry: BufferGeometry, material: M)
    material: M
  }
  export class Sprite extends Object3D {
    constructor(material: SpriteMaterial)
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

  export class Light extends Object3D {
    color: Color
  }
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

  export class WebGLRenderTarget {
    setSize(width: number, height: number): void
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

declare module 'three/examples/jsm/objects/Reflector.js' {
  import type { BufferGeometry, IUniform, Mesh, ShaderMaterial, WebGLRenderTarget } from 'three'
  export class Reflector extends Mesh<ShaderMaterial> {
    constructor(geometry: BufferGeometry, options?: {
      shader?: { name?: string; uniforms: Record<string, IUniform>; vertexShader: string; fragmentShader: string }
      clipBias?: number
      textureWidth?: number
      textureHeight?: number
      multisample?: number
    })
    getRenderTarget(): WebGLRenderTarget
    dispose(): void
  }
}

declare module 'three/examples/jsm/utils/BufferGeometryUtils.js' {
  import type { BufferGeometry } from 'three'
  export function mergeGeometries(geometries: BufferGeometry[], useGroups?: boolean): BufferGeometry
}
