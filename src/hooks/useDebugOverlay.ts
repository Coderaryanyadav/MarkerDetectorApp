/**
 * useDebugOverlay.ts
 *
 * Aggregates all real-time metrics for the debug overlay UI.
 * Reads from Reanimated SharedValues (updated by the worklet thread)
 * and exposes them as regular React state for the debug panel component.
 *
 * Update strategy:
 * - We use `useAnimatedReaction` to watch shared values and push to local
 *   state at most every 200ms (5 Hz), preventing debug renders from
 *   affecting the main render cycle.
 */
import { useState, useCallback, useRef } from 'react';
import {
  useAnimatedReaction,
  useSharedValue,
  runOnJS,
  type SharedValue,
} from 'react-native-reanimated';

import type { PipelineMetrics } from './useFrameProcessingPipeline';
import { useCurrentDetection, useDetectionStatus } from '../store/useAppStore';
import type { DetectionStatus } from '../types';

// ── Update rate limiter (200ms = 5 updates/sec — enough for humans to read) ──
const DEBUG_UPDATE_INTERVAL_MS = 200;

export interface DebugMetrics {
  cameraFPS:     number;
  processFPS:    number;
  totalFrames:   number;
  scannedFrames: number;
  skippedFrames: number;
  skipRate:      string;   // e.g. "33%"
  detectionStatus: DetectionStatus;
  markerId:      number;
  confidence:    string;   // e.g. "87.3%"
  corners:       Array<{ x: number; y: number }>;
}

export function useDebugOverlay(metrics: PipelineMetrics): DebugMetrics {
  const detection       = useCurrentDetection();
  const detectionStatus = useDetectionStatus();

  const [cameraFPS,     setCameraFPS]     = useState(0);
  const [processFPS,    setProcessFPS]    = useState(0);
  const [totalFrames,   setTotalFrames]   = useState(0);
  const [scannedFrames, setScannedFrames] = useState(0);
  const [skippedFrames, setSkippedFrames] = useState(0);

  // ── Rate-limited updater ──────────────────────────────────────────────
  // SharedValue: persists across worklet invocations AND React re-renders.
  // A plain `let` resets to 0 on every render; a useRef can't be read from worklets.
  const lastUpdateTime = useSharedValue(0);

  const applyUpdate = useCallback(
    (cf: number, pf: number, tf: number, sf: number, sk: number) => {
      setCameraFPS(cf);
      setProcessFPS(pf);
      setTotalFrames(tf);
      setScannedFrames(sf);
      setSkippedFrames(sk);
    },
    []
  );

  // Watch all metrics in a single reaction — fires on any change
  useAnimatedReaction(
    () => ({
      cf: metrics.cameraFPS.value,
      pf: metrics.processFPS.value,
      tf: metrics.totalFrames.value,
      sf: metrics.scannedFrames.value,
      sk: metrics.skippedFrames.value,
    }),
    (current) => {
      'worklet';
      const now = Date.now();
      if (now - lastUpdateTime.value < DEBUG_UPDATE_INTERVAL_MS) return;
      lastUpdateTime.value = now;
      runOnJS(applyUpdate)(
        current.cf, current.pf, current.tf, current.sf, current.sk
      );
    },
    [applyUpdate]
  );

  // ── Derived values ────────────────────────────────────────────────────────
  const skipRate = totalFrames > 0
    ? `${Math.round((skippedFrames / totalFrames) * 100)}%`
    : '0%';

  const confidence = detection?.detected
    ? `${(detection.confidence * 100).toFixed(1)}%`
    : '—';

  return {
    cameraFPS,
    processFPS,
    totalFrames,
    scannedFrames,
    skippedFrames,
    skipRate,
    detectionStatus,
    markerId:  detection?.markerId ?? -1,
    confidence,
    corners:   detection?.corners ?? [],
  };
}
