/**
 * CameraScreen.tsx  — Phase 2 production camera screen
 *
 * This screen owns:
 *   • Camera device + format selection (high-res 2K-3K)
 *   • Camera lifecycle (active/inactive)
 *   • Frame processing pipeline wiring
 *   • All overlay layers (HUD, debug panel, FPS, scan counter)
 *   • Permission gate
 *   • Zoom gesture handling
 *   • Torch (flashlight) toggle
 *   • Focus tap handling
 *
 * ── Rendering layers (bottom → top) ──────────────────────────────────────────
 *   1. <Camera>           — full-screen camera preview
 *   2. <HUDOverlay>       — Skia: grid, corners, bounding quad
 *   3. <FocusRipple>      — tap-to-focus animation
 *   4. <TopBar>           — FPS counter, status badge, torch toggle
 *   5. <ScanCounter>      — frame counts bar
 *   6. <DebugOverlayPanel>— dev metrics (toggled via volume-down gesture)
 *   7. <BottomBar>        — marker ID, confidence, zoom control
 *
 * ── Memory notes ─────────────────────────────────────────────────────────────
 *   • Camera is set isActive=false when app backgrounds → releases camera buffer
 *   • Frame processor plugin holds no long-lived references to Frame objects
 *   • Skia canvas is GPU-allocated; StyleSheet.absoluteFill prevents layout cost
 */
import React, {
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
} from 'react';
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  StatusBar,
  ActivityIndicator,
  Linking,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  withSpring,
  Easing,
  runOnJS,
} from 'react-native-reanimated';
import {
  Camera,
  useCameraPermission as useVCPermission,
  type Point,
} from 'react-native-vision-camera';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';

import { useCameraSetup } from '../hooks/useCameraSetup';
import { useFrameProcessingPipeline } from '../hooks/useFrameProcessingPipeline';
import { useDebugOverlay } from '../hooks/useDebugOverlay';
import { useHapticFeedback } from '../hooks/useHapticFeedback';
import { useMarkerDetector } from '../hooks/useMarkerDetector';
import { HUDOverlay } from '../components/hud/HUDOverlay';
import { DebugOverlayPanel } from '../components/ui/DebugOverlayPanel';
import { DetectionStatusBadge } from '../components/ui/DetectionStatusBadge';
import { FPSCounter } from '../components/ui/FPSCounter';
import { ScanCounter } from '../components/ui/ScanCounter';
import { ScanProgressBar } from '../components/ui/ScanProgressBar';
import {
  useMarkerCollection,
  useCollectionProgress,
} from '../hooks/useMarkerCollection';
import {
  useAppStore,
  useCurrentDetection,
  useDetectionStatus,
} from '../store/useAppStore';
import { COLORS, ANIMATION, DETECTION_CONFIG } from '../constants';
import type { RootStackParamList } from '../types';

type ScannerNavProp = StackNavigationProp<RootStackParamList, 'Scanner'>;

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const MIN_ZOOM = 1.0;
const MAX_ZOOM = 5.0;

// ─────────────────────────────────────────────────────────────────────────────
// CameraScreen
// ─────────────────────────────────────────────────────────────────────────────

export function CameraScreen() {
  // ── Permissions (Vision Camera built-in) ────────────────────────────────
  const { hasPermission, requestPermission } = useVCPermission();

  // ── Camera setup (device + format) ──────────────────────────────────────
  const { device, format, frameWidth, frameHeight, isReady, formatLabel } =
    useCameraSetup('back');

  // ── Frame processing pipeline ────────────────────────────────────────────
  const { frameProcessor, metrics, isPluginReady } =
    useFrameProcessingPipeline();

  // ── Native detector (initialization) ────────────────────────────────────
  const { isDetectorReady } = useMarkerDetector();

  // ── Global state ─────────────────────────────────────────────────────────
  const currentDetection = useCurrentDetection();
  const detectionStatus = useDetectionStatus();
  const { hudConfig, setCameraActive, cameraConfig, setCameraConfig } =
    useAppStore();

  // ── Debug overlay metrics ────────────────────────────────────────────────
  const debugMetrics = useDebugOverlay(metrics);
  const [debugVisible, setDebugVisible] = useState(false);

  // ── Navigation ──────────────────────────────────────────────────────────────
  const navigation = useNavigation<ScannerNavProp>();

  // ── Collection (20 unique markers) ──────────────────────────────────────────
  const { attemptCapture, isComplete: collectionComplete } = useMarkerCollection();
  const progress = useCollectionProgress();

  // ── Local state ──────────────────────────────────────────────────────────
  const [isCameraActive, setIsCameraActive] = useState(true);
  const [torchOn, setTorchOn] = useState(false);
  const cameraRef = useRef<Camera>(null);

  // ── Haptics ──────────────────────────────────────────────────────────────
  const haptics = useHapticFeedback();
  const prevDetected = useRef(false);

  useEffect(() => {
    if (!currentDetection) return;
    const nowDetected = currentDetection.detected;
    if (nowDetected && !prevDetected.current) {
      currentDetection.confidence >= DETECTION_CONFIG.HIGH_CONFIDENCE
        ? haptics.onHighConfidence()
        : haptics.onDetect();
    } else if (!nowDetected && prevDetected.current) {
      haptics.onLost();
    }
    prevDetected.current = nowDetected;
  }, [currentDetection, haptics]);

  // ── Camera active on screen focus ────────────────────────────────────────
  useFocusEffect(
    useCallback(() => {
      setIsCameraActive(true);
      setCameraActive(true);
      return () => {
        setIsCameraActive(false);
        setCameraActive(false);
      };
    }, [setCameraActive])
  );

  // ── Camera lifecycle callbacks ────────────────────────────────────────────
  const onCameraInitialized = useCallback(() => {
    console.log(`[CameraScreen] Camera initialized — ${formatLabel}`);
    setCameraActive(true);
  }, [formatLabel, setCameraActive]);

  const onCameraError = useCallback(
    (err: unknown) => {
      console.error('[CameraScreen] Camera error:', err);
      haptics.onError();
    },
    [haptics]
  );

  // ── Zoom state ────────────────────────────────────────────────────────────
  const zoom = useSharedValue(MIN_ZOOM);
  const baseZoom = useSharedValue(MIN_ZOOM);

  const pinchGesture = Gesture.Pinch()
    .onStart(() => {
      baseZoom.value = zoom.value;
    })
    .onUpdate((e) => {
      const next = baseZoom.value * e.scale;
      zoom.value = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next));
    });

  // ── Tap-to-focus ──────────────────────────────────────────────────────────
  const focusX = useSharedValue(0);
  const focusY = useSharedValue(0);
  const focusOpacity = useSharedValue(0);

  const focusRippleStyle = useAnimatedStyle(() => ({
    left: focusX.value - 32,
    top: focusY.value - 32,
    opacity: focusOpacity.value,
  }));

  const onFocusTap = useCallback(
    async (x: number, y: number) => {
      if (!cameraRef.current) return;
      focusX.value = x;
      focusY.value = y;
      focusOpacity.value = withSequence(
        withTiming(1, { duration: 100 }),
        withTiming(0, { duration: ANIMATION.slow, easing: Easing.out(Easing.ease) })
      );
      try {
        await cameraRef.current.focus({ x, y } as Point);
      } catch { /* Focus not supported — ignore */ }
    },
    [focusX, focusY, focusOpacity]
  );

  const tapGesture = Gesture.Tap()
    .onEnd((e) => {
      runOnJS(onFocusTap)(e.absoluteX, e.absoluteY);
    });

  const combinedGesture = Gesture.Simultaneous(pinchGesture, tapGesture);

  // ── Torch toggle ──────────────────────────────────────────────────────────
  const toggleTorch = useCallback(() => {
    setTorchOn((prev) => !prev);
    haptics.onDetect();
  }, [haptics]);

  // ── Debug toggle (tap FPS counter) ──────────────────────────────────────
  const toggleDebug = useCallback(() => {
    setDebugVisible((prev) => !prev);
  }, []);

  // ── Navigate to gallery ─────────────────────────────────────────────────
  const goToGallery = useCallback(() => {
    navigation.navigate('Gallery');
  }, [navigation]);

  // Auto-navigate to gallery when collection complete
  useEffect(() => {
    if (collectionComplete) {
      haptics.onHighConfidence();
      const timer = setTimeout(goToGallery, 800);
      return () => clearTimeout(timer);
    }
  }, [collectionComplete, goToGallery, haptics]);

  // ── Permission gate ───────────────────────────────────────────────────────
  if (!hasPermission) {
    return (
      <SafeAreaView style={styles.permissionContainer}>
        <View style={styles.permissionContent}>
          <View style={styles.permissionIconWrap}>
            <Text style={styles.permissionIcon}>⊙</Text>
          </View>
          <Text style={styles.permissionTitle}>Camera Access Required</Text>
          <Text style={styles.permissionDesc}>
            Marker detection needs camera access to analyse the live feed
            in real-time. No images are stored or transmitted.
          </Text>

          <Pressable
            style={({ pressed }) => [
              styles.permissionPrimaryBtn,
              pressed && styles.btnPressed,
            ]}
            onPress={requestPermission}
            accessibilityRole="button"
            accessibilityLabel="Request camera permission"
          >
            <Text style={styles.permissionBtnText}>Enable Camera</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.permissionSecondaryBtn, pressed && styles.btnPressed]}
            onPress={() => Linking.openSettings()}
            accessibilityRole="button"
            accessibilityLabel="Open app settings"
          >
            <Text style={styles.permissionSecondaryBtnText}>Open Settings</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (!device || !isReady) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={COLORS.accentPrimary} />
        <Text style={styles.loadingText}>Finding camera…</Text>
      </View>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <View style={styles.root}>
      <StatusBar
        barStyle="light-content"
        backgroundColor="transparent"
        translucent
      />

      {/* ── Layer 1: Camera ───────────────────────────────────────────── */}
      <GestureDetector gesture={combinedGesture}>
        <Camera
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          device={device}
          format={format}
          isActive={isCameraActive}
          frameProcessor={
            isDetectorReady && isPluginReady ? frameProcessor : undefined
          }
          onInitialized={onCameraInitialized}
          onError={onCameraError}
          // Zoom driven by Reanimated SharedValue — updates without React re-render
          zoom={zoom}
          // Torch (flashlight)
          torch={torchOn ? 'on' : 'off'}
          // Optimizations:
          video={false}       // Disable video recording pipeline — saves memory
          audio={false}       // No audio — saves DSP resources
          photo={false}       // Disable photo pipeline — we only need frames
          pixelFormat="yuv"   // YUV: Y-plane is grayscale → direct OpenCV input
          enableFpsGraph={__DEV__}  // Show Xcode/ADB FPS graph in debug builds
        />
      </GestureDetector>

      {/* ── Layer 2: HUD overlay (Skia) ──────────────────────────────── */}
      <HUDOverlay
        detection={currentDetection}
        hudConfig={hudConfig}
        status={detectionStatus}
      />

      {/* ── Layer 3: Focus ripple ─────────────────────────────────────── */}
      <Animated.View
        style={[styles.focusRipple, focusRippleStyle]}
        pointerEvents="none"
      />

      {/* ── Layer 4: Top bar ──────────────────────────────────────────── */}
      <SafeAreaView style={styles.topBar} edges={['top']}>
        <View style={styles.topBarContent}>
          {/* App title */}
          <Text style={styles.appTitle}>◈ MARKER DETECTOR</Text>

          {/* Right cluster: FPS + status + torch */}
          <View style={styles.topBarRight}>
            <Pressable onPress={toggleDebug} onLongPress={toggleDebug}
              accessibilityLabel="Toggle debug overlay">
              <FPSCounter
                cameraFPS={metrics.cameraFPS}
                processFPS={metrics.processFPS}
              />
            </Pressable>
            <DetectionStatusBadge status={detectionStatus} />
            <Pressable
              style={[styles.torchBtn, torchOn && styles.torchBtnActive]}
              onPress={toggleTorch}
              accessibilityRole="button"
              accessibilityLabel={torchOn ? 'Turn off torch' : 'Turn on torch'}
            >
              <Text style={styles.torchIcon}>{torchOn ? '🔦' : '⚡'}</Text>
            </Pressable>
          </View>
        </View>

        {/* Scan counter row */}
        <View style={styles.scanCounterRow}>
          <ScanCounter
            totalFrames={metrics.totalFrames}
            scannedFrames={metrics.scannedFrames}
            skippedFrames={metrics.skippedFrames}
          />
        </View>

        {/* Scan progress bar (X/20) */}
        <View style={styles.progressBarRow}>
          <ScanProgressBar />
        </View>
      </SafeAreaView>

      {/* ── Layer 5: Debug panel (bottom-left) ───────────────────────── */}
      {__DEV__ && (
        <View style={styles.debugAnchor} pointerEvents="none">
          <DebugOverlayPanel
            metrics={debugMetrics}
            visible={debugVisible}
            formatLabel={formatLabel}
          />
        </View>
      )}

      {/* ── Layer 6: Bottom bar ───────────────────────────────────────── */}
      <SafeAreaView style={styles.bottomBar} edges={['bottom']}>
        {/* Detection result panel */}
        {currentDetection?.detected ? (
          <DetectionResultPanel
            markerId={currentDetection.markerId as number}
            confidence={currentDetection.confidence}
          />
        ) : (
          <ScanHintBar status={detectionStatus} />
        )}

        {/* Zoom bar */}
        <ZoomIndicator zoom={zoom} min={MIN_ZOOM} max={MAX_ZOOM} />

        {/* Gallery button */}
        <View style={styles.galleryBtnRow}>
          <Pressable
            style={({ pressed }) => [styles.galleryBtn, pressed && styles.btnPressed]}
            onPress={goToGallery}
            accessibilityRole="button"
            accessibilityLabel={`View gallery: ${progress.current} of ${progress.target} collected`}
          >
            <Text style={styles.galleryBtnText}>
              VIEW GALLERY ({progress.current}/{progress.target})
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>

      {/* ── Detector not ready notice ─────────────────────────────────── */}
      {(!isDetectorReady || !isPluginReady) && (
        <View style={styles.initNotice} pointerEvents="none">
          <ActivityIndicator size="small" color={COLORS.accentPrimary} />
          <Text style={styles.initNoticeText}>
            {!isDetectorReady ? 'Loading detector…' : 'Linking plugin…'}
          </Text>
        </View>
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

const DetectionResultPanel = React.memo(function DetectionResultPanel({
  markerId,
  confidence,
}: {
  markerId: number;
  confidence: number;
}) {
  const pct = Math.round(confidence * 100);
  const isHigh = confidence >= DETECTION_CONFIG.HIGH_CONFIDENCE;
  const color = isHigh ? COLORS.accentPrimary : COLORS.accentWarning;

  return (
    <View style={[styles.resultPanel, { borderTopColor: color }]}>
      <View style={styles.resultPanelLeft}>
        <Text style={[styles.resultMarkerLabel, { color }]}>MARKER {markerId}</Text>
        <Text style={styles.resultSubLabel}>DETECTED</Text>
      </View>
      <View style={styles.confidenceWrap}>
        <Text style={[styles.confidenceValue, { color }]}>{pct}%</Text>
        <Text style={styles.confidenceLabel}>CONFIDENCE</Text>
        {/* Confidence bar */}
        <View style={styles.confBarTrack}>
          <View style={[styles.confBarFill, { width: `${pct}%` as any, backgroundColor: color }]} />
        </View>
      </View>
    </View>
  );
});

const ScanHintBar = React.memo(function ScanHintBar({
  status,
}: {
  status: string;
}) {
  const hint =
    status === 'idle'
      ? 'Camera ready — point at a marker'
      : 'Scanning… align marker within the frame';

  return (
    <View style={styles.scanHintBar}>
      <View style={styles.scanDot} />
      <Text style={styles.scanHintText}>{hint}</Text>
    </View>
  );
});

const ZoomIndicator = React.memo(function ZoomIndicator({
  zoom,
  min,
  max,
}: {
  zoom: Animated.SharedValue<number>;
  min: number;
  max: number;
}) {
  const labelStyle = useAnimatedStyle(() => ({
    opacity: zoom.value > min + 0.1 ? 1 : 0.5,
  }));

  return (
    <View style={styles.zoomRow}>
      <Text style={styles.zoomHint}>Pinch to zoom</Text>
      <Animated.Text style={[styles.zoomLabel, labelStyle]}>
        {zoom.value.toFixed(1)}×
      </Animated.Text>
    </View>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },

  // ── Permission screen ──────────────────────────────────────────────────────
  permissionContainer: {
    flex: 1,
    backgroundColor: COLORS.bgDeep,
  },
  permissionContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 36,
    gap: 20,
  },
  permissionIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: COLORS.bgCard,
    borderWidth: 2,
    borderColor: COLORS.accentSecondary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  permissionIcon: { fontSize: 36, color: COLORS.accentSecondary },
  permissionTitle: {
    color: COLORS.textPrimary,
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  permissionDesc: {
    color: COLORS.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
  },
  permissionPrimaryBtn: {
    backgroundColor: COLORS.accentPrimary,
    paddingHorizontal: 40,
    paddingVertical: 14,
    borderRadius: 14,
    width: '100%',
    alignItems: 'center',
  },
  permissionBtnText: {
    color: COLORS.bgDeep,
    fontSize: 16,
    fontWeight: '700',
  },
  permissionSecondaryBtn: {
    paddingHorizontal: 40,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.textMuted,
    width: '100%',
    alignItems: 'center',
  },
  permissionSecondaryBtnText: {
    color: COLORS.textSecondary,
    fontSize: 14,
  },
  btnPressed: { opacity: 0.75, transform: [{ scale: 0.97 }] },

  // ── Loading ────────────────────────────────────────────────────────────────
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.bgDeep,
    gap: 16,
  },
  loadingText: {
    color: COLORS.textSecondary,
    fontSize: 14,
    fontFamily: 'monospace',
  },

  // ── Focus ripple ───────────────────────────────────────────────────────────
  focusRipple: {
    position: 'absolute',
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2,
    borderColor: COLORS.accentSecondary,
    pointerEvents: 'none',
  },

  // ── Top bar ────────────────────────────────────────────────────────────────
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  topBarContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  appTitle: {
    color: COLORS.textPrimary,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 2.5,
    fontFamily: 'monospace',
  },
  topBarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  torchBtn: {
    padding: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  torchBtnActive: {
    backgroundColor: 'rgba(255,184,0,0.2)',
    borderColor: COLORS.accentWarning,
  },
  torchIcon: { fontSize: 16 },
  scanCounterRow: {
    alignItems: 'center',
    paddingBottom: 8,
    paddingHorizontal: 16,
  },

  // ── Debug anchor ───────────────────────────────────────────────────────────
  debugAnchor: {
    position: 'absolute',
    left: 16,
    bottom: 160,
  },

  // ── Bottom bar ─────────────────────────────────────────────────────────────
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  resultPanel: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderTopWidth: 2,
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 16,
  },
  resultPanelLeft: { gap: 2 },
  resultMarkerLabel: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 1,
    fontFamily: 'monospace',
  },
  resultSubLabel: {
    color: COLORS.textMuted,
    fontSize: 10,
    letterSpacing: 2,
    fontFamily: 'monospace',
  },
  confidenceWrap: {
    alignItems: 'flex-end',
    gap: 4,
    minWidth: 90,
  },
  confidenceValue: {
    fontSize: 22,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  confidenceLabel: {
    color: COLORS.textMuted,
    fontSize: 9,
    letterSpacing: 2,
    fontFamily: 'monospace',
  },
  confBarTrack: {
    width: 80,
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  confBarFill: {
    height: 3,
    borderRadius: 2,
  },

  scanHintBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  scanDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.accentSecondary,
  },
  scanHintText: {
    color: COLORS.textSecondary,
    fontSize: 13,
  },

  zoomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 8,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  zoomHint: { color: COLORS.textMuted, fontSize: 11 },
  zoomLabel: {
    color: COLORS.textPrimary,
    fontSize: 13,
    fontWeight: '700',
    fontFamily: 'monospace',
  },

  // ── Progress bar row ───────────────────────────────────────────────────────
  progressBarRow: {
    paddingVertical: 6,
  },

  // ── Gallery button ─────────────────────────────────────────────────────────
  galleryBtnRow: {
    alignItems: 'center',
    paddingVertical: 8,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  galleryBtn: {
    backgroundColor: COLORS.accentSecondary,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 10,
  },
  galleryBtnText: {
    color: COLORS.bgDeep,
    fontSize: 11,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 1,
  },

  // ── Init notice ────────────────────────────────────────────────────────────
  initNotice: {
    position: 'absolute',
    bottom: 140,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.overlayDark,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(0,255,136,0.3)',
  },
  initNoticeText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontFamily: 'monospace',
  },
});
