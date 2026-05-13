/**
 * HUDOverlay.tsx — Phase 3 update
 *
 * Renders all visualization layers using React Native Skia:
 *
 *   Layer 1 — Scanning grid (always visible, faint green lines)
 *   Layer 2 — Candidate contours (debug: blue quads — all shapes passing filter)
 *   Layer 3 — Bounding quad of detected marker (green fill + stroke)
 *   Layer 4 — Corner brackets (4 L-shaped brackets at each corner)
 *   Layer 5 — Sweep line animation (visible while scanning)
 *   Layer 6 — Center crosshair
 *
 * Coordinate system:
 *   All corner/contour points arrive from the C++ layer in ORIGINAL camera
 *   frame coordinates. They must be mapped to SCREEN coordinates:
 *     screenX = cornerX * (screenW / cameraW)
 *     screenY = cornerY * (screenH / cameraH)
 *   Since the camera preview fills the screen (StyleSheet.absoluteFill),
 *   the camera frame and screen dimensions are effectively the same.
 *   We pass camera frame dimensions (frameWidth, frameHeight) for the scaling.
 */
import React, { useMemo, useCallback, useEffect } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import {
  Canvas,
  Path,
  Line,
  vec,
  Group,
} from '@shopify/react-native-skia';
import Animated, {
  useSharedValue,
  withRepeat,
  withTiming,
  Easing as ReanimatedEasing,
} from 'react-native-reanimated';

import type { DetectionResult, HUDConfig, DetectionStatus } from '../../types';
import { COLORS, ANIMATION, DETECTION_CONFIG } from '../../constants';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface Point2D { x: number; y: number; }

interface HUDOverlayProps {
  detection:    DetectionResult | null;
  hudConfig:    HUDConfig;
  status:       DetectionStatus;
  /** Camera frame dimensions (for corner coordinate scaling) */
  frameWidth?:  number;
  frameHeight?: number;
  /** Candidate contours from debug data (blue overlay) */
  debugCandidates?: Point2D[][];
}

// ─────────────────────────────────────────────────────────────────────────────
// HUDOverlay
// ─────────────────────────────────────────────────────────────────────────────

export function HUDOverlay({
  detection,
  hudConfig,
  status,
  frameWidth  = 1280,
  frameHeight = 720,
  debugCandidates = [],
}: HUDOverlayProps) {
  const { width: screenW, height: screenH } = useWindowDimensions();
  const isDetected = detection?.detected === true;

  // Scale factors: camera frame → screen
  const scaleX = screenW  / frameWidth;
  const scaleY = screenH / frameHeight;

  // Helper: scale a camera-space point to screen space
  // Memoized so useMemo hooks below capture a stable reference.
  const toScreen = useCallback(
    (p: Point2D): Point2D => ({
      x: p.x * scaleX,
      y: p.y * scaleY,
    }),
    [scaleX, scaleY]
  );

  // ── Scan line animation (standard Reanimated — no Skia experimental API) ──
  // Runs a repeating 0→1 linear animation on the UI thread.
  const scanProgress = useSharedValue(0);
  useEffect(() => {
    scanProgress.value = withRepeat(
      withTiming(1, {
        duration: ANIMATION.scan,
        easing: ReanimatedEasing.linear,
      }),
      -1,   // infinite repeats
      false  // don't reverse
    );
  }, [scanProgress]);

  // ── Color based on confidence ────────────────────────────────────────────
  const markerColor = useMemo(() => {
    if (!isDetected) return COLORS.scannerLine;
    return detection!.confidence >= DETECTION_CONFIG.HIGH_CONFIDENCE
      ? COLORS.accentPrimary   // Green
      : COLORS.accentWarning;  // Amber
  }, [isDetected, detection]);

  const cornerSize = hudConfig.cornerSize;
  const lineWidth  = hudConfig.lineWidth;

  // ── Grid lines ───────────────────────────────────────────────────────────
  const gridLines = useMemo(() => {
    if (!hudConfig.showGrid) return [];
    const lines: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
    const COLS = 3, ROWS = 4;
    for (let i = 1; i < COLS; i++) {
      const x = (screenW / COLS) * i;
      lines.push({ x1: x, y1: 0, x2: x, y2: screenH });
    }
    for (let j = 1; j < ROWS; j++) {
      const y = (screenH / ROWS) * j;
      lines.push({ x1: 0, y1: y, x2: screenW, y2: y });
    }
    return lines;
  }, [screenW, screenH, hudConfig.showGrid]);

  // ── Debug candidate contours (blue quads) ────────────────────────────────
  const candidatePaths = useMemo(() => {
    if (!debugCandidates?.length) return [];
    return debugCandidates.map((contour) => {
      if (contour.length < 3) return null;
      const scaled = contour.map(toScreen);
      let path = `M ${scaled[0].x} ${scaled[0].y}`;
      for (let i = 1; i < scaled.length; i++) {
        path += ` L ${scaled[i].x} ${scaled[i].y}`;
      }
      path += ' Z';
      return path;
    }).filter(Boolean) as string[];
  }, [debugCandidates, scaleX, scaleY]);

  // ── Bounding quad path (detected marker) ────────────────────────────────
  const { boundingPath, scaledCorners } = useMemo(() => {
    if (!isDetected || !detection?.corners?.length || detection.corners.length < 4) {
      return { boundingPath: null, scaledCorners: [] };
    }
    const sc = detection.corners.map(toScreen);
    const path = `M ${sc[0].x} ${sc[0].y} L ${sc[1].x} ${sc[1].y} L ${sc[2].x} ${sc[2].y} L ${sc[3].x} ${sc[3].y} Z`;
    return { boundingPath: path, scaledCorners: sc };
  }, [isDetected, detection, scaleX, scaleY]);

  // ── Corner bracket paths ─────────────────────────────────────────────────
  const cornerPaths = useMemo(() => {
    if (!isDetected || !hudConfig.showCorners || scaledCorners.length < 4) return [];

    // For each corner, draw an L-bracket pointing inward
    return scaledCorners.map((corner, i) => {
      // Determine inward direction based on corner position
      const dx = i === 0 || i === 3 ? cornerSize : -cornerSize;
      const dy = i === 0 || i === 1 ? cornerSize : -cornerSize;
      return `M ${corner.x + dx} ${corner.y} L ${corner.x} ${corner.y} L ${corner.x} ${corner.y + dy}`;
    });
  }, [isDetected, hudConfig.showCorners, scaledCorners, cornerSize]);

  // ── Corner labels (TL, TR, BR, BL) ──────────────────────────────────────
  // Note: Skia text requires a loaded font. We use the debug overlay panel for
  // text labels instead to avoid font loading complexity in the Canvas.

  const cx = screenW / 2;
  const cy = screenH / 2;
  const crossSize = 20;

  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">

      {/* ── Grid ── */}
      {gridLines.map((line, i) => (
        <Line
          key={`grid-${i}`}
          p1={vec(line.x1, line.y1)}
          p2={vec(line.x2, line.y2)}
          color={COLORS.scannerGrid}
          strokeWidth={0.5}
          style="stroke"
        />
      ))}

      {/* ── Debug: Candidate contours (blue) ── */}
      {candidatePaths.map((path, i) => (
        <Path
          key={`cand-${i}`}
          path={path}
          color={`${COLORS.accentSecondary}80`}   // 50% alpha
          style="stroke"
          strokeWidth={1.5}
        />
      ))}

      {/* ── Scan sweep line (only when not detected) ── */}
      {!isDetected && status === 'scanning' && (
        <Line
          p1={vec(0,       scanProgress.value * screenH)}
          p2={vec(screenW, scanProgress.value * screenH)}
          color={`${COLORS.scannerLine}55`}
          strokeWidth={1.5}
          style="stroke"
        />
      )}

      {/* ── Detected marker bounding quad ── */}
      {boundingPath && (
        <Group>
          {/* Semi-transparent fill */}
          <Path
            path={boundingPath}
            color={`${markerColor}25`}
            style="fill"
          />
          {/* Solid stroke */}
          <Path
            path={boundingPath}
            color={markerColor}
            style="stroke"
            strokeWidth={lineWidth}
          />
        </Group>
      )}

      {/* ── Corner brackets ── */}
      {cornerPaths.map((path, i) => (
        <Path
          key={`corner-${i}`}
          path={path}
          color={markerColor}
          style="stroke"
          strokeWidth={lineWidth + 1}
          strokeCap="round"
          strokeJoin="round"
        />
      ))}

      {/* ── Center crosshair ── */}
      <Line
        p1={vec(cx - crossSize, cy)}
        p2={vec(cx + crossSize, cy)}
        color={`${COLORS.scannerCorner}60`}
        strokeWidth={1}
        style="stroke"
      />
      <Line
        p1={vec(cx, cy - crossSize)}
        p2={vec(cx, cy + crossSize)}
        color={`${COLORS.scannerCorner}60`}
        strokeWidth={1}
        style="stroke"
      />

    </Canvas>
  );
}
