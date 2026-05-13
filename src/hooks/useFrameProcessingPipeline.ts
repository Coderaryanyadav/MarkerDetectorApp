/**
 * useFrameProcessingPipeline.ts
 *
 * Builds the Vision Camera frame processor with a multi-stage pipeline:
 *
 *   Stage 1 — THROTTLE GATE
 *     Skip frames if we're processing too fast for the detector to keep up.
 *     WHY: The camera delivers 30 fps. Our OpenCV detector takes ~50ms/frame
 *     on mid-range hardware = max 20 fps. Without throttling, frames queue up
 *     and memory grows unbounded.
 *
 *   Stage 2 — QUALITY GATE
 *     Skip frames that are too dark/blurry to produce good detections.
 *     WHY: Reduces wasted CPU cycles on frames that will never match.
 *     (Currently gated behind DEBUG flag — full impl in Phase 3.)
 *
 *   Stage 3 — NATIVE DETECTION
 *     Call the VisionCamera plugin → JNI → OpenCV on the remaining frames.
 *
 *   Stage 4 — RESULT RELAY
 *     runOnJS() to push results back to the React/Zustand layer.
 *
 * Memory management:
 * - Frames are stack-allocated by Vision Camera and released after the
 *   worklet returns. We never hold a reference to Frame objects.
 * - Detection results are plain JS objects (no native refs) so GC handles them.
 * - frameTimestamps ring buffer is capped at 60 entries.
 *
 * Performance bottlenecks:
 * - JNI call overhead: ~1–3ms per frame. Unavoidable; kept minimal by not
 *   copying full frame bytes across the bridge (plugin accesses frame in-place).
 * - runOnJS: ~0.5–1ms serialization. We batch the result into one call.
 * - Reanimated shared values: zero-copy reads from worklet thread.
 */
import { useCallback, useRef } from 'react';
import {
  useFrameProcessor,
  VisionCameraProxy,
  Frame,
} from 'react-native-vision-camera';
import {
  useSharedValue,
  runOnJS,
  type SharedValue,
} from 'react-native-reanimated';

import { useAppStore } from '../store/useAppStore';
import { DETECTION_CONFIG } from '../constants';
import type { DetectionResult, NativeDetectionResult } from '../types';

// ── Plugin initialization ─────────────────────────────────────────────────────
// VisionCameraProxy.initFrameProcessorPlugin must be called at module level
// (not inside a hook or component) so the plugin is registered before any
// frame arrives.
const detectorPlugin = VisionCameraProxy.initFrameProcessorPlugin(
  'markerDetector',
  {
    // Plugin options passed to the native side at init time:
    // downsampleWidth:  width to resize the frame to before feature extraction
    // downsampleHeight: height to resize to
    // These MUST match what the C++ plugin expects.
    downsampleWidth: 640,
    downsampleHeight: 480,
  }
);

// ── Constants ────────────────────────────────────────────────────────────────

/** Process at most this many frames per second */
const MAX_PROCESS_FPS = 20;
const MIN_FRAME_INTERVAL_MS = 1000 / MAX_PROCESS_FPS; // 50ms

/** After this many consecutive missed frames, reset debounce counters */
const MAX_MISS_STREAK = 60;

// ── Public interface ─────────────────────────────────────────────────────────

export interface PipelineMetrics {
  /** Live frames-per-second rendered by camera */
  cameraFPS: SharedValue<number>;
  /** Frames actually sent to detector per second */
  processFPS: SharedValue<number>;
  /** Total frames received from camera since session start */
  totalFrames: SharedValue<number>;
  /** Total frames processed by detector (not skipped) */
  scannedFrames: SharedValue<number>;
  /** Total frames skipped due to throttle gate */
  skippedFrames: SharedValue<number>;
  /** Most recent raw plugin result (null = no detection) */
  lastResult: SharedValue<NativeDetectionResult | null>;
}

export interface FrameProcessorOutput {
  frameProcessor: ReturnType<typeof useFrameProcessor>;
  metrics: PipelineMetrics;
  isPluginReady: boolean;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useFrameProcessingPipeline(): FrameProcessorOutput {
  const { setDetectionResult, setFPS, isDetectorReady } = useAppStore();

  // ── Shared values (readable from both worklet & JS threads) ───────────────
  const cameraFPS = useSharedValue(0);
  const processFPS = useSharedValue(0);
  const totalFrames = useSharedValue(0);
  const scannedFrames = useSharedValue(0);
  const skippedFrames = useSharedValue(0);
  const lastResult = useSharedValue<NativeDetectionResult | null>(null);

  // ── Shared value for worklet-thread throttle gate ──────────────────────────
  // IMPORTANT: This MUST be a SharedValue — not a useRef — because it's
  // read and written inside the frame processor worklet. Refs are JS-only.
  const lastProcessTime = useSharedValue(0);

  // ── Refs (JS thread only — not accessible from worklet) ──────────────────
  const lastCameraFPSTime = useRef(Date.now());
  const cameraFrameCount = useRef(0);
  const processFrameCount = useRef(0);
  const lastProcessFPSTime = useRef(Date.now());

  // Debounce counters
  const consecutiveDetections = useRef(0);
  const consecutiveMisses = useRef(0);

  // ── JS-thread result handler ──────────────────────────────────────────────
  // Called via runOnJS from the worklet thread.
  // Runs on JS thread — can call hooks, setState, etc.
  const onFrameResult = useCallback(
    (raw: NativeDetectionResult | null, frameTimestamp: number) => {
      // ── FPS bookkeeping ──────────────────────────────────────────────────

      // Camera FPS (all frames received)
      cameraFrameCount.current += 1;
      const now = Date.now();
      const cameraElapsed = (now - lastCameraFPSTime.current) / 1000;
      if (cameraElapsed >= 0.5) {
        const fps = Math.round(cameraFrameCount.current / cameraElapsed);
        cameraFPS.value = fps;
        setFPS(fps);
        cameraFrameCount.current = 0;
        lastCameraFPSTime.current = now;
      }

      // Process FPS (frames sent to detector)
      processFrameCount.current += 1;
      const processElapsed = (now - lastProcessFPSTime.current) / 1000;
      if (processElapsed >= 0.5) {
        processFPS.value = Math.round(processFrameCount.current / processElapsed);
        processFrameCount.current = 0;
        lastProcessFPSTime.current = now;
      }

      if (!raw) return;

      // ── Debounce logic ───────────────────────────────────────────────────
      if (raw.detected && raw.confidence >= DETECTION_CONFIG.MIN_CONFIDENCE) {
        consecutiveDetections.current += 1;
        consecutiveMisses.current = 0;

        if (consecutiveDetections.current >= DETECTION_CONFIG.DETECTION_DEBOUNCE_FRAMES) {
          const result: DetectionResult = {
            detected: true,
            markerId: raw.markerId as 1 | 2,
            confidence: raw.confidence,
            corners: raw.corners ?? [],
            timestamp: frameTimestamp,
          };
          setDetectionResult(result);
        }
      } else {
        consecutiveMisses.current += 1;
        consecutiveDetections.current = 0;

        if (consecutiveMisses.current >= DETECTION_CONFIG.LOST_DEBOUNCE_FRAMES) {
          consecutiveMisses.current = Math.min(consecutiveMisses.current, MAX_MISS_STREAK);
          setDetectionResult({
            detected: false,
            markerId: -1,
            confidence: 0,
            corners: [],
            timestamp: frameTimestamp,
          });
        }
      }
    },
    [setDetectionResult, setFPS, cameraFPS, processFPS]
  );

  // ── Frame Processor (runs on Vision Camera worklet thread) ────────────────
  const frameProcessor = useFrameProcessor(
    (frame: Frame) => {
      'worklet';

      // ── Counter updates (shared values = worklet-safe) ──────────────────
      totalFrames.value += 1;

      // ── STAGE 1: THROTTLE GATE ───────────────────────────────────────────
      // Vision Camera calls this function synchronously for every camera frame.
      // We skip frames that arrive faster than MIN_FRAME_INTERVAL_MS to cap
      // the detector at MAX_PROCESS_FPS.
      //
      // frame.timestamp is in nanoseconds on Android.
      const nowMs = frame.timestamp / 1_000_000; // ns → ms
      if (nowMs - lastProcessTime.value < MIN_FRAME_INTERVAL_MS) {
        skippedFrames.value += 1;
        // Still relay a null result so the JS thread can update the FPS counter
        runOnJS(onFrameResult)(null, nowMs);
        return;
      }
      lastProcessTime.value = nowMs;

      // ── STAGE 2: QUALITY GATE ────────────────────────────────────────────
      // In Phase 3, add a fast Laplacian variance check here:
      //   const sharpness = plugin.callSharpness(frame);
      //   if (sharpness < SHARPNESS_THRESHOLD) { skippedFrames.value++; return; }
      //
      // Skipped for now — the native plugin handles poor-quality frames gracefully.

      // ── STAGE 3: NATIVE DETECTION ────────────────────────────────────────
      scannedFrames.value += 1;

      let result: NativeDetectionResult | null = null;

      if (detectorPlugin) {
        // plugin.call() is a synchronous native call on the worklet thread.
        // It does NOT block the JS thread.
        // The plugin internally:
        //   1. Accesses frame bytes via Frame's internal buffer (zero-copy)
        //   2. Downsamples to 640×480 in C++
        //   3. Runs ORB + BFMatcher + homography
        //   4. Returns a plain JS object
        const raw = detectorPlugin.call(frame);
        if (raw && typeof raw === 'object') {
          result = raw as NativeDetectionResult;
          lastResult.value = result;
        }
      }

      // ── STAGE 4: RESULT RELAY ────────────────────────────────────────────
      // Bridge the result from the worklet thread to the JS thread.
      // runOnJS queues the callback on the JS event loop — it does NOT block
      // the worklet thread. The worklet returns immediately after this call.
      runOnJS(onFrameResult)(result, nowMs);
    },
    [onFrameResult, totalFrames, scannedFrames, skippedFrames, lastResult, lastProcessTime]
  );

  return {
    frameProcessor,
    metrics: {
      cameraFPS,
      processFPS,
      totalFrames,
      scannedFrames,
      skippedFrames,
      lastResult,
    },
    isPluginReady: !!detectorPlugin,
  };
}
