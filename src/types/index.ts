/**
 * Application-wide TypeScript type definitions.
 *
 * Convention:
 * - Interfaces for object shapes
 * - Types for unions, mapped types, utilities
 * - Enums for fixed sets of named constants
 */

// ─────────────────────────────────────────────────────────────────────────────
// Marker Types
// ─────────────────────────────────────────────────────────────────────────────

export type MarkerId = 1 | 2;

export interface MarkerCorner {
  x: number;
  y: number;
}

export interface DetectionResult {
  detected: boolean;
  markerId: MarkerId | -1;
  confidence: number;          // 0.0 – 1.0
  corners: MarkerCorner[];     // 4 corners of the detected marker bounding quad
  timestamp: number;           // ms since epoch
}

export interface MarkerTemplate {
  id: MarkerId;
  name: string;
  assetPath: string;           // Path within android/app/src/main/assets/
  expectedAspectRatio: number; // width / height
}

// ─────────────────────────────────────────────────────────────────────────────
// Detection State
// ─────────────────────────────────────────────────────────────────────────────

export type DetectionStatus =
  | 'idle'
  | 'scanning'
  | 'detected'
  | 'lost'
  | 'error';

export interface DetectionSession {
  status:       DetectionStatus;
  currentResult: DetectionResult | null;
  fps:          number;
  frameCount:   number;
  sessionStart: number;        // ms since epoch
}

// ─────────────────────────────────────────────────────────────────────────────
// Camera Types
// ─────────────────────────────────────────────────────────────────────────────

export type CameraFacing = 'front' | 'back';
export type FlashMode   = 'off' | 'on' | 'auto';
export type FocusMode   = 'auto' | 'continuous';

export interface CameraConfig {
  facing:         CameraFacing;
  flash:          FlashMode;
  zoom:           number;      // 1.0 = no zoom
  enableHdr:      boolean;
  enableNightMode: boolean;
  targetFPS:      number;      // Frame processor target FPS
  pixelFormat:    'yuv' | 'rgb';
}

// ─────────────────────────────────────────────────────────────────────────────
// HUD Overlay Types
// ─────────────────────────────────────────────────────────────────────────────

export interface HUDConfig {
  showGrid:        boolean;
  showCorners:     boolean;
  showConfidence:  boolean;
  showFPS:         boolean;
  overlayColor:    string;     // hex color
  cornerSize:      number;     // pixels
  lineWidth:       number;     // pixels
}

// ─────────────────────────────────────────────────────────────────────────────
// Collected Marker Types
// ─────────────────────────────────────────────────────────────────────────────

/** A single 300×300 processed marker image saved from a unique frame */
export interface CollectedMarker {
  /** Unique ID for React key & dedup tracking */
  id:             string;
  /** Index in the collection (1-based: 1 → 20) */
  index:          number;
  /** Marker ID from the detection result (1 or 2) */
  markerId:       number;
  /** Base64-encoded JPEG of the 300×300 processed marker */
  imageBase64:    string;
  /** Confidence score at time of capture */
  confidence:     number;
  /** Timestamp when this marker was captured */
  capturedAt:     number;
  /** Perceptual hash for duplicate rejection (64-bit as hex string) */
  perceptualHash: string;
  /** Detected orientation before correction (0, 90, 180, 270) */
  orientationDeg: number;
  /** Processing time for this frame in ms */
  processingTimeMs: number;
}

/** Collection state machine */
export type CollectionStatus =
  | 'collecting'   // Actively capturing markers
  | 'complete'     // All 20 collected
  | 'paused';      // Manually paused by user

export interface CollectionState {
  status:        CollectionStatus;
  markers:       CollectedMarker[];
  targetCount:   number;  // 20
  duplicatesRejected: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Processing Timing Metrics
// ─────────────────────────────────────────────────────────────────────────────

export interface ProcessingTimingMetrics {
  /** Grayscale conversion (ms) */
  grayscaleMs:     number;
  /** Gaussian blur (ms) */
  blurMs:          number;
  /** Adaptive threshold (ms) */
  thresholdMs:     number;
  /** Contour detection (ms) */
  contoursMs:      number;
  /** Candidate filtering (ms) */
  filterMs:        number;
  /** Perspective warp + code extraction (ms) */
  warpMs:          number;
  /** Total frame processing (ms) */
  totalMs:         number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Navigation Types
// ─────────────────────────────────────────────────────────────────────────────

export type RootStackParamList = {
  Scanner:  undefined;
  Gallery:  undefined;
  Settings: undefined;
  About:    undefined;
  Results:  { result: DetectionResult };
};

// ─────────────────────────────────────────────────────────────────────────────
// NativeModule Types
// ─────────────────────────────────────────────────────────────────────────────

export interface NativeDetectionResult {
  detected:   boolean;
  markerId:   number;
  confidence: number;
  corners:    Array<{ x: number; y: number }>;
}

export interface MarkerDetectorNativeModule {
  initialize(marker1Path: string, marker2Path: string): Promise<boolean>;
  detectFrame(
    yuvData: number[],
    width:   number,
    height:  number
  ): Promise<NativeDetectionResult>;
  getDebugData(): Promise<NativeDebugData>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

export interface NativeDebugData {
  candidateCount:    number;
  allContourCount:   number;
  candidates:        Array<Array<{ x: number; y: number }>>;
  hasFinal:          boolean;
  finalCorners:      Array<{ x: number; y: number }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Duplicate rejection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Perceptual hash comparison result.
 * Two images with Hamming distance ≤ HASH_SIMILARITY_THRESHOLD are duplicates.
 */
export interface HashComparisonResult {
  isDuplicate: boolean;
  distance:    number;
  hash:        string;
}
