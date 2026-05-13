/**
 * useMarkerCollection.ts — Manages the collection of 20 unique markers.
 *
 * Responsibilities:
 *   1. Listen for high-confidence detections from the pipeline
 *   2. Request the 300×300 processed image from the native module
 *   3. Compute perceptual hash of the processed image
 *   4. Reject duplicates (Hamming distance check against existing collection)
 *   5. Store accepted markers in Zustand
 *   6. Track scan progress (X / 20)
 *   7. Auto-stop when 20 unique markers are collected
 *
 * Threading model:
 *   - Detection arrives from the frame processor (worklet thread → runOnJS)
 *   - Hash computation and duplicate check run on the JS thread
 *   - Since we're processing at most ~2 captures/second (throttled by
 *     MIN_CAPTURE_INTERVAL_MS), this doesn't block the UI thread meaningfully
 *
 * Memory management:
 *   - Base64 strings for 300×300 JPEG at quality 85 are ~15–30 KB each
 *   - 20 markers × 30 KB = ~600 KB total — well within JS heap limits
 */
import { useCallback, useRef } from 'react';
import { NativeModules } from 'react-native';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

import { COLLECTION_CONFIG, DUPLICATE_REJECTION } from '../constants';
import { computePerceptualHash, isDuplicateFrame } from '../processing/DuplicateDetector';
import type {
  CollectedMarker,
  CollectionState,
  CollectionStatus,
  DetectionResult,
} from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Collection Store (separate from the main app store for SRP)
// ─────────────────────────────────────────────────────────────────────────────

interface CollectionStoreShape {
  collection: CollectionState;
  addMarker: (marker: CollectedMarker) => void;
  incrementDuplicates: () => void;
  setStatus: (status: CollectionStatus) => void;
  reset: () => void;
}

const initialCollectionState: CollectionState = {
  status: 'collecting',
  markers: [],
  targetCount: COLLECTION_CONFIG.TARGET_COUNT,
  duplicatesRejected: 0,
};

export const useCollectionStore = create<CollectionStoreShape>()(
  immer((set) => ({
    collection: initialCollectionState,

    addMarker: (marker) =>
      set((state) => {
        state.collection.markers.push(marker);
        if (state.collection.markers.length >= state.collection.targetCount) {
          state.collection.status = 'complete';
        }
      }),

    incrementDuplicates: () =>
      set((state) => {
        state.collection.duplicatesRejected += 1;
      }),

    setStatus: (status) =>
      set((state) => {
        state.collection.status = status;
      }),

    reset: () =>
      set((state) => {
        state.collection = { ...initialCollectionState };
      }),
  }))
);

// Selectors
export const useCollectedMarkers = () =>
  useCollectionStore((s) => s.collection.markers);
export const useCollectionStatus = () =>
  useCollectionStore((s) => s.collection.status);
export const useCollectionProgress = () =>
  useCollectionStore((s) => ({
    current: s.collection.markers.length,
    target: s.collection.targetCount,
    percent: Math.round((s.collection.markers.length / s.collection.targetCount) * 100),
    isComplete: s.collection.status === 'complete',
    duplicatesRejected: s.collection.duplicatesRejected,
  }));

// ─────────────────────────────────────────────────────────────────────────────
// useMarkerCollection hook
// ─────────────────────────────────────────────────────────────────────────────

export function useMarkerCollection() {
  const {
    collection,
    addMarker,
    incrementDuplicates,
    setStatus,
    reset,
  } = useCollectionStore();

  // Throttle: prevent capturing too fast
  const lastCaptureTime = useRef(0);

  // ── Cached hash array to avoid per-frame allocation ─────────────────────
  // Updated only when a marker is actually captured (at most 20 times total).
  // This prevents creating a new string[] from .map() on every frame.
  const cachedHashes = useRef<string[]>([]);

  /**
   * Attempt to capture a marker from the current detection.
   *
   * @param detection  The current high-confidence detection result
   * @param processedImageBase64  Base64 JPEG of the 300×300 processed marker
   *                              (fetched from native module after detection)
   * @param processingTimeMs  Time taken to process this frame
   * @returns  { captured: boolean, reason: string }
   */
  const attemptCapture = useCallback(
    (
      detection: DetectionResult,
      processedImageBase64: string,
      processingTimeMs: number
    ): { captured: boolean; reason: string } => {
      // ── Gate 1: Collection already complete ──────────────────────────────
      if (collection.status !== 'collecting') {
        return { captured: false, reason: 'Collection complete or paused' };
      }

      // ── Gate 2: Enough confidence ────────────────────────────────────────
      if (!detection.detected || detection.confidence < COLLECTION_CONFIG.AUTO_CAPTURE_CONFIDENCE) {
        return { captured: false, reason: `Low confidence: ${detection.confidence.toFixed(2)}` };
      }

      // ── Gate 3: Throttle ─────────────────────────────────────────────────
      const now = Date.now();
      if (now - lastCaptureTime.current < COLLECTION_CONFIG.MIN_CAPTURE_INTERVAL_MS) {
        return { captured: false, reason: 'Throttled — too soon after last capture' };
      }

      // ── Gate 4: Duplicate rejection ──────────────────────────────────────
      // Decode base64 to compute perceptual hash.
      // For performance: we compute the hash from a simplified representation.
      // The base64 string IS the processed 300×300 marker, so we hash its content.
      const hash = computePerceptualHashFromBase64(processedImageBase64);

      // Use cached hashes — no allocation per frame
      const dupResult = isDuplicateFrame(hash, cachedHashes.current);

      if (dupResult.isDuplicate) {
        incrementDuplicates();
        return {
          captured: false,
          reason: `Duplicate frame (distance=${dupResult.minDistance})`,
        };
      }

      // ── All gates passed — capture the marker ───────────────────────────
      const marker: CollectedMarker = {
        id: `marker-${now}-${collection.markers.length}`,
        index: collection.markers.length + 1,
        markerId: detection.markerId as number,
        imageBase64: processedImageBase64,
        confidence: detection.confidence,
        capturedAt: now,
        perceptualHash: hash,
        orientationDeg: 0,  // Orientation already corrected by native pipeline
        processingTimeMs,
      };

      addMarker(marker);
      lastCaptureTime.current = now;

      // Append to cached hashes — O(1) instead of O(n) rebuild
      cachedHashes.current.push(hash);

      return {
        captured: true,
        reason: `Captured marker ${marker.index}/${collection.targetCount}`,
      };
    },
    // Narrowed dependencies: only the store actions (stable references) and
    // the status/length needed for gate checks. Avoids full collection rebuild.
    [collection.status, collection.markers.length, collection.targetCount, addMarker, incrementDuplicates]
  );

  const pauseCollection = useCallback(() => setStatus('paused'), [setStatus]);
  const resumeCollection = useCallback(() => setStatus('collecting'), [setStatus]);
  const resetCollection = useCallback(() => {
    lastCaptureTime.current = 0;
    cachedHashes.current = [];  // Clear hash cache on reset
    reset();
  }, [reset]);

  return {
    collection,
    attemptCapture,
    pauseCollection,
    resumeCollection,
    resetCollection,
    isComplete: collection.status === 'complete',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute a perceptual hash from a base64-encoded JPEG image.
 *
 * Strategy: We decode the base64 data and use the raw byte distribution
 * as a proxy for pixel values. This is not pixel-perfect (JPEG encoding
 * adds headers and compression artifacts), but for our purposes, the
 * byte distribution of different 300×300 marker images produces
 * sufficiently different hashes.
 *
 * For a more precise approach, the native module would compute the hash
 * in C++ from the raw grayscale pixel data before JPEG encoding.
 * See MarkerDetector.cpp nativeComputeHash().
 *
 * As a practical compromise: we sample 64 evenly-spaced bytes from the
 * decoded base64 payload and threshold against the median.
 */
function computePerceptualHashFromBase64(base64: string): string {
  // Decode base64 → raw bytes
  // In React Native, atob is available via Hermes.
  const raw = base64.replace(/^data:image\/\w+;base64,/, '');
  const binaryStr = atob(raw);
  const len = binaryStr.length;

  // Sample 64 evenly-spaced bytes from the payload
  const HASH_BITS = 64;
  const samples: number[] = new Array(HASH_BITS);
  const step = Math.max(1, Math.floor(len / HASH_BITS));

  for (let i = 0; i < HASH_BITS; i++) {
    const byteIdx = Math.min(i * step, len - 1);
    samples[i] = binaryStr.charCodeAt(byteIdx);
  }

  // Compute mean
  let sum = 0;
  for (const s of samples) sum += s;
  const mean = sum / HASH_BITS;

  // Generate hash: bit = 1 if sample >= mean
  let hashHex = '';
  for (let byteIdx = 0; byteIdx < 8; byteIdx++) {
    let byte = 0;
    for (let bitIdx = 0; bitIdx < 8; bitIdx++) {
      const sampleIdx = byteIdx * 8 + bitIdx;
      if (samples[sampleIdx] >= mean) {
        byte |= (1 << (7 - bitIdx));
      }
    }
    hashHex += byte.toString(16).padStart(2, '0');
  }

  return hashHex;
}
