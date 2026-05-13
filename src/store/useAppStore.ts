/**
 * Zustand store for global application state.
 *
 * Zustand was chosen over Redux because:
 * - Zero boilerplate
 * - Works perfectly with Immer for immutable updates
 * - Supports subscriptions without Provider overhead
 * - Tiny bundle size (2.1kb gzipped)
 */
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { DetectionResult, DetectionSession, CameraConfig, HUDConfig } from '../types';
import { DEFAULT_CAMERA_CONFIG, DEFAULT_HUD_CONFIG } from '../constants';

// ─────────────────────────────────────────────────────────────────────────────
// Store Shape
// ─────────────────────────────────────────────────────────────────────────────

interface AppState {
  // Detection
  session: DetectionSession;
  detectionHistory: DetectionResult[];
  isDetectorReady: boolean;

  // Camera
  cameraConfig: CameraConfig;
  isCameraActive: boolean;

  // HUD
  hudConfig: HUDConfig;
  isHUDVisible: boolean;

  // Actions
  setDetectionResult: (result: DetectionResult) => void;
  clearDetection: () => void;
  setFPS: (fps: number) => void;
  setDetectorReady: (ready: boolean) => void;
  setCameraConfig: (config: Partial<CameraConfig>) => void;
  setHUDConfig: (config: Partial<HUDConfig>) => void;
  toggleHUD: () => void;
  setCameraActive: (active: boolean) => void;
  resetSession: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Initial State
// ─────────────────────────────────────────────────────────────────────────────

const initialSession: DetectionSession = {
  status: 'idle',
  currentResult: null,
  fps: 0,
  frameCount: 0,
  sessionStart: Date.now(),
};

// ─────────────────────────────────────────────────────────────────────────────
// Store
// ─────────────────────────────────────────────────────────────────────────────

export const useAppStore = create<AppState>()(
  immer((set) => ({
    // Initial state
    session: initialSession,
    detectionHistory: [],
    isDetectorReady: false,
    cameraConfig: DEFAULT_CAMERA_CONFIG,
    isCameraActive: false,
    hudConfig: DEFAULT_HUD_CONFIG,
    isHUDVisible: true,

    // Actions
    setDetectionResult: (result) =>
      set((state) => {
        state.session.currentResult = result;
        state.session.status = result.detected ? 'detected' : 'scanning';
        state.session.frameCount += 1;

        // Keep last 50 results in history for analytics
        if (result.detected) {
          state.detectionHistory.unshift(result);
          if (state.detectionHistory.length > 50) {
            state.detectionHistory.pop();
          }
        }
      }),

    clearDetection: () =>
      set((state) => {
        state.session.currentResult = null;
        state.session.status = 'scanning';
      }),

    setFPS: (fps) =>
      set((state) => {
        state.session.fps = fps;
      }),

    setDetectorReady: (ready) =>
      set((state) => {
        state.isDetectorReady = ready;
      }),

    setCameraConfig: (config) =>
      set((state) => {
        Object.assign(state.cameraConfig, config);
      }),

    setHUDConfig: (config) =>
      set((state) => {
        Object.assign(state.hudConfig, config);
      }),

    toggleHUD: () =>
      set((state) => {
        state.isHUDVisible = !state.isHUDVisible;
      }),

    setCameraActive: (active) =>
      set((state) => {
        state.isCameraActive = active;
        state.session.status = active ? 'scanning' : 'idle';
      }),

    resetSession: () =>
      set((state) => {
        state.session = { ...initialSession, sessionStart: Date.now() };
        state.detectionHistory = [];
      }),
  }))
);

// ─────────────────────────────────────────────────────────────────────────────
// Selector hooks — memoized to prevent unnecessary re-renders
// ─────────────────────────────────────────────────────────────────────────────

export const useDetectionStatus = () =>
  useAppStore((s) => s.session.status);

export const useCurrentDetection = () =>
  useAppStore((s) => s.session.currentResult);

export const useFPS = () =>
  useAppStore((s) => s.session.fps);

export const useIsDetectorReady = () =>
  useAppStore((s) => s.isDetectorReady);

export const useHUDConfig = () =>
  useAppStore((s) => s.hudConfig);

export const useCameraConfig = () =>
  useAppStore((s) => s.cameraConfig);
