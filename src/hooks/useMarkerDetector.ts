/**
 * useMarkerDetector — Custom hook that bridges Vision Camera frame processor
 * with the native OpenCV MarkerDetectorModule.
 *
 * Architecture:
 *
 *   Camera Frame (30fps)
 *        │
 *        ▼
 *   useFrameProcessor (runs on VisionCamera worklet thread)
 *        │  calls plugin.call() → JNI → OpenCV C++
 *        │
 *        ▼
 *   runOnJS(onResult) → JS thread → Zustand store → React re-render
 *
 * This separation ensures OpenCV processing never blocks the JS thread.
 */
import { useEffect, useCallback, useRef } from 'react';
import { NativeModules, NativeEventEmitter } from 'react-native';
import {
  useFrameProcessor,
  VisionCameraProxy,
} from 'react-native-vision-camera';
import { runOnJS } from 'react-native-reanimated';

import { useAppStore } from '../store/useAppStore';
import { DETECTION_CONFIG, MARKER_TEMPLATES, NATIVE_EVENTS } from '../constants';
import type { DetectionResult, NativeDetectionResult } from '../types';

// Initialize the Vision Camera plugin proxy
// This connects our frame processor to the native 'markerDetector' plugin
const plugin = VisionCameraProxy.initFrameProcessorPlugin('markerDetector', {});

// ─────────────────────────────────────────────────────────────────────────────
// useMarkerDetector
// ─────────────────────────────────────────────────────────────────────────────

export function useMarkerDetector() {
  const {
    setDetectionResult,
    setDetectorReady,
    setFPS,
    isDetectorReady,
  } = useAppStore();

  // FPS tracking
  const frameTimestamps = useRef<number[]>([]);
  const consecutiveDetections = useRef<number>(0);
  const consecutiveMisses      = useRef<number>(0);

  // ── Initialization ────────────────────────────────────────────────────────
  useEffect(() => {
    const nativeModule = NativeModules.MarkerDetectorModule;

    if (!nativeModule) {
      console.warn(
        '[useMarkerDetector] MarkerDetectorModule not found. ' +
        'Make sure native build is linked and the app was rebuilt.'
      );
      return;
    }

    const initialize = async () => {
      try {
        const marker1 = MARKER_TEMPLATES[0].assetPath;
        const marker2 = MARKER_TEMPLATES[1].assetPath;
        await nativeModule.initialize(marker1, marker2);
        setDetectorReady(true);
        console.log('[MarkerDetector] Native engine initialized ✓');
      } catch (err) {
        console.error('[MarkerDetector] Initialization failed:', err);
        setDetectorReady(false);
      }
    };

    initialize();

    // Listen for native detection events (emitted from background thread)
    const emitter = new NativeEventEmitter(nativeModule);
    const subscription = emitter.addListener(
      NATIVE_EVENTS.MARKER_DETECTED,
      (event: { markerId: number; confidence: number }) => {
        console.log('[MarkerDetector] Event:', event);
      }
    );

    return () => {
      subscription.remove();
    };
  }, [setDetectorReady]);

  // ── FPS calculation (runs on JS thread) ───────────────────────────────────
  const updateFPS = useCallback(() => {
    const now = Date.now();
    frameTimestamps.current.push(now);

    // Keep only last 30 frame timestamps
    if (frameTimestamps.current.length > 30) {
      frameTimestamps.current.shift();
    }

    if (frameTimestamps.current.length >= 2) {
      const oldest = frameTimestamps.current[0];
      const elapsed = (now - oldest) / 1000;
      const fps = Math.round((frameTimestamps.current.length - 1) / elapsed);
      setFPS(fps);
    }
  }, [setFPS]);

  // ── Result handler (runs on JS thread via runOnJS) ────────────────────────
  const onDetectionResult = useCallback(
    (raw: NativeDetectionResult) => {
      updateFPS();

      if (raw.detected && raw.confidence >= DETECTION_CONFIG.MIN_CONFIDENCE) {
        consecutiveDetections.current += 1;
        consecutiveMisses.current = 0;

        if (consecutiveDetections.current >= DETECTION_CONFIG.DETECTION_DEBOUNCE_FRAMES) {
          const result: DetectionResult = {
            detected:   true,
            markerId:   raw.markerId as 1 | 2,
            confidence: raw.confidence,
            corners:    raw.corners,
            timestamp:  Date.now(),
          };
          setDetectionResult(result);
        }
      } else {
        consecutiveMisses.current += 1;
        consecutiveDetections.current = 0;

        if (consecutiveMisses.current >= DETECTION_CONFIG.LOST_DEBOUNCE_FRAMES) {
          const result: DetectionResult = {
            detected:   false,
            markerId:   -1,
            confidence: 0,
            corners:    [],
            timestamp:  Date.now(),
          };
          setDetectionResult(result);
        }
      }
    },
    [updateFPS, setDetectionResult]
  );

  // ── Frame Processor ────────────────────────────────────────────────────────
  // This function runs on the Vision Camera worklet thread (not JS thread).
  // IMPORTANT: Only worklet-compatible operations are allowed here.
  // Use runOnJS() to bridge back to the JS thread.
  const frameProcessor = useFrameProcessor(
    (frame) => {
      'worklet';

      if (!plugin) return;

      // Call the native frame processor plugin
      // The plugin internally calls MarkerDetectorModule's JNI methods
      const result = plugin.call(frame) as NativeDetectionResult | null;

      if (result !== null && result !== undefined) {
        // Bridge result back to JS thread for state updates
        runOnJS(onDetectionResult)(result);
      }
    },
    [onDetectionResult]
  );

  return {
    frameProcessor,
    isDetectorReady,
  };
}
