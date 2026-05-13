/**
 * useCameraSetup.ts
 *
 * Handles camera device selection and format negotiation.
 *
 * Resolution strategy:
 * - We TARGET 2000–3000px for the camera CAPTURE format so the viewfinder
 *   renders at high fidelity and any saved snapshots are high-quality.
 * - For FRAME PROCESSING we downsample to 640×480 inside the worklet
 *   (OpenCV operates on the downsampled copy), keeping the worklet thread fast.
 *
 * Why not process at 3000×3000?
 *   ORB feature detection at 3K is ~25× slower than at 640×480.
 *   The marker's feature geometry is scale-invariant, so we lose nothing.
 *
 * Format selection priority:
 *   1. Resolution closest to MAX_PROCESS_RESOLUTION from above (prefer higher)
 *   2. Highest achievable FPS at that resolution
 *   3. YUV pixel format (avoids RGB conversion overhead in OpenCV)
 */
import { useMemo } from 'react';
import {
  useCameraDevice,
  useCameraFormat,
  CameraDevice,
  CameraFormat,
  VideoStabilizationMode,
} from 'react-native-vision-camera';
import type { CameraFacing } from '../types';

// ── Target resolutions ────────────────────────────────────────────────────────
/** Preview/capture target — maximum side length for the viewfinder */
const TARGET_CAPTURE_WIDTH  = 2560;
const TARGET_CAPTURE_HEIGHT = 1920;

/** Minimum acceptable resolution — reject formats below this */
const MIN_WIDTH  = 1280;
const MIN_HEIGHT = 720;

/** Target FPS for frame processing */
const TARGET_FPS = 30;

// ── Return shape ──────────────────────────────────────────────────────────────
export interface CameraSetup {
  device:        CameraDevice | undefined;
  format:        CameraFormat | undefined;
  /** Actual width of the chosen format */
  frameWidth:    number;
  /** Actual height of the chosen format */
  frameHeight:   number;
  /** Max frames-per-second at the chosen format */
  maxFPS:        number;
  /** True when device and format are ready */
  isReady:       boolean;
  /** Human-readable description for debug overlay */
  formatLabel:   string;
}

export function useCameraSetup(facing: CameraFacing = 'back'): CameraSetup {
  // 1. Select device
  const device = useCameraDevice(facing, {
    physicalDevices: [
      'wide-angle-camera',   // Most common — prefer the main wide lens
      'ultra-wide-angle-camera', // Fallback
    ],
  });

  // 2. Select best matching format
  //    useCameraFormat accepts an array of "wishes" sorted by priority.
  //    It picks the format that best satisfies all constraints simultaneously.
  const format = useCameraFormat(device, [
    // Primary goal: closest to our target resolution
    { videoResolution: { width: TARGET_CAPTURE_WIDTH, height: TARGET_CAPTURE_HEIGHT } },
    // Secondary: highest FPS
    { fps: TARGET_FPS },
    // Bonus: video stabilization if available (reduces motion blur during scanning)
    { videoStabilizationMode: 'auto' satisfies VideoStabilizationMode },
  ]);

  // 3. Compute derived values
  const frameWidth  = format?.videoWidth  ?? 0;
  const frameHeight = format?.videoHeight ?? 0;
  const maxFPS      = format?.maxFps       ?? 0;

  const isReady = !!device && !!format &&
    frameWidth  >= MIN_WIDTH &&
    frameHeight >= MIN_HEIGHT;

  const formatLabel = format
    ? `${frameWidth}×${frameHeight} @ ${maxFPS}fps`
    : 'No format';

  return { device, format, frameWidth, frameHeight, maxFPS, isReady, formatLabel };
}
