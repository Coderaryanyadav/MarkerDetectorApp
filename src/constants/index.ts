/**
 * Application-wide constants.
 * Centralizing these avoids magic numbers scattered across the codebase.
 */

import type { MarkerTemplate, HUDConfig, CameraConfig } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Marker Templates
// ─────────────────────────────────────────────────────────────────────────────

export const MARKER_TEMPLATES: MarkerTemplate[] = [
  {
    id: 1,
    name: 'Marker 1',
    assetPath: 'markers/marker1_reference.jpg',
    expectedAspectRatio: 1.0,  // Update after measuring actual markers
  },
  {
    id: 2,
    name: 'Marker 2',
    assetPath: 'markers/marker2_reference.jpg',
    expectedAspectRatio: 1.0,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Detection Thresholds
// ─────────────────────────────────────────────────────────────────────────────

export const DETECTION_CONFIG = {
  /** Minimum feature match count to consider a detection valid */
  MIN_MATCH_COUNT: 15,
  /** Lowe's ratio test threshold — lower = stricter matching */
  LOWE_RATIO: 0.75,
  /** Confidence below this → treat as "not detected" */
  MIN_CONFIDENCE: 0.4,
  /** Confidence above this → "high confidence" detection (green indicator) */
  HIGH_CONFIDENCE: 0.75,
  /** Frames the marker must persist before emitting "detected" event */
  DETECTION_DEBOUNCE_FRAMES: 3,
  /** After marker disappears for N frames → emit "lost" event */
  LOST_DEBOUNCE_FRAMES: 5,
  /** Maximum homography reprojection error (pixels) */
  MAX_REPROJ_ERROR: 8.0,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Default Camera Config
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_CAMERA_CONFIG: CameraConfig = {
  facing: 'back',
  flash: 'off',
  zoom: 1.0,
  enableHdr: false,
  enableNightMode: false,
  targetFPS: 30,       // 30 FPS is sufficient for marker detection
  pixelFormat: 'yuv',    // YUV is more efficient than RGB for CV ops
};

// ─────────────────────────────────────────────────────────────────────────────
// Default HUD Config
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_HUD_CONFIG: HUDConfig = {
  showGrid: true,
  showCorners: true,
  showConfidence: true,
  showFPS: true,
  overlayColor: '#00FF88',  // Neon green — high contrast on camera feeds
  cornerSize: 20,
  lineWidth: 2,
};

// ─────────────────────────────────────────────────────────────────────────────
// Color Palette
// ─────────────────────────────────────────────────────────────────────────────

export const COLORS = {
  // Background
  bgDeep: '#0A0E1A',
  bgCard: '#111827',
  bgMuted: '#1C2333',

  // Accent
  accentPrimary: '#00FF88',   // Neon green — detection success
  accentSecondary: '#00BFFF',   // Electric blue — UI accents
  accentWarning: '#FFB800',   // Amber — low confidence
  accentDanger: '#FF3B5C',   // Red — error / imposter marker

  // Text
  textPrimary: '#FFFFFF',
  textSecondary: '#8B9AB2',
  textMuted: '#4A5568',

  // Overlays
  overlayDark: 'rgba(0, 0, 0, 0.7)',
  overlayLight: 'rgba(255, 255, 255, 0.05)',

  // Scanner
  scannerLine: '#00FF88',
  scannerCorner: '#00BFFF',
  scannerGrid: 'rgba(0, 255, 136, 0.15)',
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Animation Durations (ms)
// ─────────────────────────────────────────────────────────────────────────────

export const ANIMATION = {
  fast: 150,
  normal: 300,
  slow: 500,
  pulse: 1200,
  scan: 2000,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Collection Config
// ─────────────────────────────────────────────────────────────────────────────

export const COLLECTION_CONFIG = {
  /** Total markers to collect */
  TARGET_COUNT: 20,
  /** Minimum confidence to auto-capture a marker */
  AUTO_CAPTURE_CONFIDENCE: 0.65,
  /** Minimum time between captures (ms) — prevents burst-capturing the same marker */
  MIN_CAPTURE_INTERVAL_MS: 500,
  /** JPEG quality for saved 300×300 markers (0–100) */
  JPEG_QUALITY: 85,
  /** Output size for processed markers */
  OUTPUT_SIZE: 300,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Duplicate Rejection
// ─────────────────────────────────────────────────────────────────────────────

export const DUPLICATE_REJECTION = {
  /**
   * Maximum Hamming distance between two perceptual hashes to consider them
   * the "same" frame.
   *
   * Perceptual hash = 64-bit hash of a downscaled 8×8 grayscale image.
   * Two identical images → distance = 0.
   * Two completely different images → expected distance ≈ 32.
   * Threshold of 10 → images must differ in at least 15% of their spatial structure.
   */
  HASH_SIMILARITY_THRESHOLD: 10,
  /** Size to downscale before hashing (8×8 = 64 bits) */
  HASH_SIZE: 8,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Native Module Event Names
// ─────────────────────────────────────────────────────────────────────────────

export const NATIVE_EVENTS = {
  MARKER_DETECTED: 'onMarkerDetected',
} as const;
