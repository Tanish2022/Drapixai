declare module 'sharp' {
  export interface Sharp {
    metadata(): Promise<Metadata>;
    composite(composites: Composite[]): Sharp;
    toFile(path: string): Promise<OutputInfo>;
    toBuffer(): Promise<Buffer>;
    png(options?: Record<string, unknown>): Sharp;
    resize(width: number, height: number, options?: ResizeOptions): Sharp;
    rotate(angle: number, options?: RotateOptions): Sharp;
    flip(): Sharp;
    flop(): Sharp;
    grayscale(): Sharp;
    linear(r: number, g: number, b: number): Sharp;
    modulate(modulation: Modulation): Sharp;
    tint(color: string | number[]): Sharp;
    blur(sigma: number): Sharp;
    sharpen(sigma: number, m1: number, m2: number): Sharp;
    median(size: number): Sharp;
    noise(options: NoiseOptions): Sharp;
    normalize(): Sharp;
    linearize(): Sharp;
    extract(region: Region): Sharp;
    extractChannel(channel: string | number): Sharp;
    joinChannel(channels: string | number[]): Sharp;
    bandbool(operator: string): Sharp;
    boolean(image: string | Buffer | Sharp, operator: string): Sharp;
    ensureAlpha(alpha?: number): Sharp;
    extractAlpha(): Sharp;
    removeAlpha(): Sharp;
    withMetadata(metadata?: Metadata): Sharp;
    withoutMetadata(): Sharp;
    rotate(angle: number): Sharp;
    flip(): Sharp;
    flop(): Sharp;
    affine(matrix: number[], options?: AffineOptions): Sharp;
    modulate(modulation: Modulation): Sharp;
    tint(color: string): Sharp;
    negate(options?: NegateOptions): Sharp;
    convolve(kernel: Kernel): Sharp;
    threshold(threshold: number, options?: ThresholdOptions): Sharp;
    boolean(image: string | Buffer | Sharp, operator: string, options?: BooleanOptions): Sharp;
    linear(a: number, b: number): Sharp;
    recomb(matrix: number[][]): Sharp;
    modulate(modulation: Modulation): Sharp;
    tint(color: string | number[]): Sharp;
    grayscale(): Sharp;
    opacity(threshold: number): Sharp;
    linear(a: number, b: number): Sharp;
    normalize(): Sharp;
    clahe(options?: ClaheOptions): Sharp;
    recalc(options?: RecalcOptions): Sharp;
    linearize(): Sharp;
    withMetadata(metadata?: Metadata): Sharp;
    withoutMetadata(): Sharp;
    rotate(angle: number, options?: RotateOptions): Sharp;
    flip(): Sharp;
    flop(): Sharp;
    affine(matrix: number[], options?: AffineOptions): Sharp;
    extract(region: Region): Sharp;
    trim(threshold?: number): Sharp;
    extend(padding: number | ExtendOptions): Sharp;
    clone(): Sharp;
  }

  export interface Metadata {
    width?: number;
    height?: number;
    space?: string;
    channels?: number;
    depth?: string;
    density?: number;
    chromaSubsampling?: string;
    isProgressive?: boolean;
    hasProfile?: boolean;
    hasAlpha?: boolean;
  }

  export interface OutputInfo {
    format: string;
    size: number;
    width: number;
    height: number;
    channels: number;
    depth: string;
    density: number;
    isProgressive: boolean;
    hasProfile: boolean;
    hasAlpha: boolean;
  }

  export interface ResizeOptions {
    fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside';
    position?: number | string;
    background?: string | number[] | { r: number; g: number; b: number; alpha?: number };
    kernel?: string;
    withoutEnlargement?: boolean;
  }

  export interface RotateOptions {
    background?: string | number[];
  }

  export interface Composite {
    input: string | Buffer | Sharp;
    top?: number;
    left?: number;
    blend?: string;
  }

  export interface Modulation {
    brightness?: number;
    saturation?: number;
    hue?: number;
  }

  export interface Region {
    left: number;
    top: number;
    width: number;
    height: number;
  }

  export interface Kernel {
    width: number;
    height: number;
    kernel: number[];
    scale?: number;
    offset?: number;
  }

  export interface NoiseOptions {
    type?: 'gaussian';
    mean?: number;
    sigma?: number;
  }

  export interface ThresholdOptions {
    grayscale?: boolean;
  }

  export interface BooleanOptions {
    raw?: {
      width: number;
      height: number;
      channels: number;
    };
  }

  export interface NegateOptions {
    grayscale?: boolean;
  }

  export interface AffineOptions {
    background?: string | number[];
    interpolate?: string;
  }

  export interface ClaheOptions {
    width: number;
    height: number;
    maxSlope?: number;
  }

  export interface RecalcOptions {
    r: number;
    g: number;
    b: number;
  }

  export interface ExtendOptions {
    top?: number;
    bottom?: number;
    left?: number;
    right?: number;
    background?: string | number[];
  }

  function sharp(input?: string | Buffer, options?: SharpOptions): Sharp;

  interface SharpOptions {
    failOnError?: boolean;
    pages?: number;
    page?: number;
    level?: number;
    subifd?: boolean;
    withMetadata?: boolean;
    withOrientation?: boolean;
  }

  export default sharp;
}
