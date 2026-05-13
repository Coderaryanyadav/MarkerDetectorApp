/**
 * ScannerScreen — Main camera + detection screen.
 *
 * Component hierarchy:
 *   ScannerScreen
 *   ├── Camera (Vision Camera)
 *   ├── HUDOverlay (Skia canvas — rendered over camera)
 *   │   ├── ScannerGrid
 *   │   ├── MarkerCorners
 *   │   └── ConfidenceBar
 *   ├── StatusBar (top)
 *   └── Controls (bottom)
 */
import React, { useRef, useCallback, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  StatusBar,
  ActivityIndicator,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useCameraDevice,
  useCameraFormat,
  Camera,
} from 'react-native-vision-camera';

import { useMarkerDetector }   from '../hooks/useMarkerDetector';
import { useCameraPermission } from '../hooks/useCameraPermission';
import { useHapticFeedback }   from '../hooks/useHapticFeedback';
import { HUDOverlay }          from '../components/hud/HUDOverlay';
import { DetectionStatusBadge } from '../components/ui/DetectionStatusBadge';
import {
  useAppStore,
  useCurrentDetection,
  useDetectionStatus,
  useFPS,
} from '../store/useAppStore';
import { COLORS, ANIMATION, DETECTION_CONFIG } from '../constants';

export function ScannerScreen() {
  // ── Permissions ─────────────────────────────────────────────────────────
  const { isGranted, permissionState, requestPermission } = useCameraPermission();

  // ── Camera device & format ───────────────────────────────────────────────
  const device = useCameraDevice('back');
  const format = useCameraFormat(device, [
    { fps: 30 },
    { videoResolution: { width: 1280, height: 720 } },
  ]);

  // ── Detection ────────────────────────────────────────────────────────────
  const { frameProcessor, isDetectorReady } = useMarkerDetector();
  const currentDetection  = useCurrentDetection();
  const detectionStatus   = useDetectionStatus();
  const fps               = useFPS();
  const { setCameraActive, hudConfig } = useAppStore();

  // ── Haptics ──────────────────────────────────────────────────────────────
  const haptics         = useHapticFeedback();
  const prevDetected    = useRef(false);

  // Trigger haptic on detection state change
  useEffect(() => {
    if (!currentDetection) return;

    const isNowDetected = currentDetection.detected;
    if (isNowDetected && !prevDetected.current) {
      if (currentDetection.confidence >= DETECTION_CONFIG.HIGH_CONFIDENCE) {
        haptics.onHighConfidence();
      } else {
        haptics.onDetect();
      }
    } else if (!isNowDetected && prevDetected.current) {
      haptics.onLost();
    }
    prevDetected.current = isNowDetected;
  }, [currentDetection, haptics]);

  // ── Camera lifecycle ─────────────────────────────────────────────────────
  const onCameraInitialized = useCallback(() => {
    setCameraActive(true);
    console.log('[ScannerScreen] Camera initialized');
  }, [setCameraActive]);

  const onCameraError = useCallback((error: unknown) => {
    console.error('[ScannerScreen] Camera error:', error);
    haptics.onError();
  }, [haptics]);

  // ── Permission gate ──────────────────────────────────────────────────────
  if (permissionState === 'checking' || permissionState === 'unknown') {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={COLORS.accentPrimary} />
        <Text style={styles.loadingText}>Initializing…</Text>
      </View>
    );
  }

  if (!isGranted) {
    return (
      <SafeAreaView style={styles.permissionContainer}>
        <View style={styles.permissionContent}>
          <Text style={styles.permissionTitle}>Camera Access Required</Text>
          <Text style={styles.permissionDesc}>
            Marker detection requires camera access to identify physical markers
            in real-time.
          </Text>
          <Pressable
            style={({ pressed }) => [
              styles.permissionButton,
              pressed && styles.permissionButtonPressed,
            ]}
            onPress={requestPermission}
            accessibilityRole="button"
            accessibilityLabel="Grant camera permission"
          >
            <Text style={styles.permissionButtonText}>Grant Permission</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (!device) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>No camera device found.</Text>
      </View>
    );
  }

  // ── Main render ──────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      {/* Camera */}
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        format={format}
        isActive={true}
        frameProcessor={isDetectorReady ? frameProcessor : undefined}
        onInitialized={onCameraInitialized}
        onError={onCameraError}
        enableZoomGesture={false}
        video={false}
        audio={false}
        pixelFormat="yuv"
        fps={30}
      />

      {/* HUD Overlay — rendered on top of camera feed */}
      <HUDOverlay
        detection={currentDetection}
        hudConfig={hudConfig}
        status={detectionStatus}
      />

      {/* Top status bar */}
      <SafeAreaView style={styles.topBar} edges={['top']}>
        <View style={styles.topBarContent}>
          <Text style={styles.appTitle}>MARKER DETECTOR</Text>
          <View style={styles.topBarRight}>
            {hudConfig.showFPS && (
              <View style={styles.fpsBadge}>
                <Text style={styles.fpsText}>{fps} FPS</Text>
              </View>
            )}
            <DetectionStatusBadge status={detectionStatus} />
          </View>
        </View>
      </SafeAreaView>

      {/* Bottom info bar */}
      <SafeAreaView style={styles.bottomBar} edges={['bottom']}>
        {currentDetection?.detected && (
          <View style={styles.detectionInfo}>
            <Text style={styles.detectionTitle}>
              Marker {currentDetection.markerId} Detected
            </Text>
            <Text style={styles.detectionConfidence}>
              {Math.round(currentDetection.confidence * 100)}% confidence
            </Text>
          </View>
        )}
        {!currentDetection?.detected && (
          <Text style={styles.scanHint}>
            Point camera at a marker to begin detection
          </Text>
        )}
      </SafeAreaView>

      {/* Detector not ready overlay */}
      {!isDetectorReady && (
        <View style={styles.initOverlay}>
          <ActivityIndicator size="small" color={COLORS.accentPrimary} />
          <Text style={styles.initText}>Loading detection engine…</Text>
        </View>
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bgDeep,
  },
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
  errorText: {
    color: COLORS.accentDanger,
    fontSize: 16,
  },

  // Permission screen
  permissionContainer: {
    flex: 1,
    backgroundColor: COLORS.bgDeep,
    justifyContent: 'center',
  },
  permissionContent: {
    padding: 32,
    alignItems: 'center',
    gap: 16,
  },
  permissionTitle: {
    color: COLORS.textPrimary,
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  permissionDesc: {
    color: COLORS.textSecondary,
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  permissionButton: {
    backgroundColor: COLORS.accentPrimary,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 8,
  },
  permissionButtonPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.97 }],
  },
  permissionButtonText: {
    color: COLORS.bgDeep,
    fontSize: 16,
    fontWeight: '700',
  },

  // Top bar
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
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  appTitle: {
    color: COLORS.textPrimary,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 3,
    fontFamily: 'monospace',
  },
  topBarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  fpsBadge: {
    backgroundColor: COLORS.overlayDark,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: COLORS.accentSecondary,
  },
  fpsText: {
    color: COLORS.accentSecondary,
    fontSize: 11,
    fontWeight: '600',
    fontFamily: 'monospace',
  },

  // Bottom bar
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  detectionInfo: {
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderTopWidth: 1,
    borderTopColor: COLORS.accentPrimary,
    padding: 16,
    alignItems: 'center',
    gap: 4,
  },
  detectionTitle: {
    color: COLORS.accentPrimary,
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 1,
  },
  detectionConfidence: {
    color: COLORS.textSecondary,
    fontSize: 13,
  },
  scanHint: {
    color: COLORS.textMuted,
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },

  // Init overlay
  initOverlay: {
    position: 'absolute',
    bottom: 120,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.overlayDark,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  initText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontFamily: 'monospace',
  },
});
