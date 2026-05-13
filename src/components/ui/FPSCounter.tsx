/**
 * FPSCounter.tsx
 *
 * Real-time FPS badge driven by Reanimated SharedValue.
 *
 * Rendering strategy:
 * - Border color driven by useAnimatedStyle (UI thread — zero JS involvement)
 * - Text updates throttled to 5Hz via useAnimatedReaction → runOnJS
 *   to avoid triggering a React reconciliation on every frame
 * - Color thresholds: 25fps (green) / 15fps (amber) / below (red)
 */
import React, { memo, useState, useCallback } from 'react';
import { StyleSheet, Text } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useAnimatedReaction,
  useSharedValue,
  runOnJS,
  type SharedValue,
} from 'react-native-reanimated';
import { COLORS } from '../../constants';

// Throttle text updates to 5Hz — fast enough for humans, minimal GC
const FPS_TEXT_UPDATE_INTERVAL_MS = 200;

interface FPSCounterProps {
  cameraFPS:  SharedValue<number>;
  processFPS: SharedValue<number>;
}

export const FPSCounter = memo(function FPSCounter({
  cameraFPS,
  processFPS,
}: FPSCounterProps) {
  // Animated style for camera FPS badge background — changes color with FPS
  const camBadgeStyle = useAnimatedStyle(() => ({
    borderColor: cameraFPS.value >= 25
      ? COLORS.accentPrimary
      : cameraFPS.value >= 15
        ? COLORS.accentWarning
        : COLORS.accentDanger,
  }));

  const procBadgeStyle = useAnimatedStyle(() => ({
    borderColor: processFPS.value >= 18
      ? COLORS.accentSecondary
      : processFPS.value >= 10
        ? COLORS.accentWarning
        : COLORS.accentDanger,
  }));

  return (
    <Animated.View style={styles.container}>
      {/* Camera FPS — raw frame delivery rate */}
      <Animated.View style={[styles.badge, camBadgeStyle]}>
        <ThrottledFPSLabel sharedFPS={cameraFPS} prefix="CAM" />
      </Animated.View>

      {/* Process FPS — frames actually sent to detector */}
      <Animated.View style={[styles.badge, procBadgeStyle]}>
        <ThrottledFPSLabel sharedFPS={processFPS} prefix="DET" />
      </Animated.View>
    </Animated.View>
  );
});

// ── Throttled label — max 5 re-renders/sec instead of 30 ─────────────────────

const ThrottledFPSLabel = memo(function ThrottledFPSLabel({
  sharedFPS,
  prefix,
}: {
  sharedFPS: SharedValue<number>;
  prefix: string;
}) {
  const [displayFPS, setDisplayFPS] = useState(0);
  const lastTextUpdate = useSharedValue(0);

  const updateText = useCallback((fps: number) => {
    setDisplayFPS(fps);
  }, []);

  // Watch the shared value on the UI thread, throttle updates to JS thread
  useAnimatedReaction(
    () => sharedFPS.value,
    (currentFPS) => {
      'worklet';
      const now = Date.now();
      if (now - lastTextUpdate.value < FPS_TEXT_UPDATE_INTERVAL_MS) return;
      lastTextUpdate.value = now;
      runOnJS(updateText)(currentFPS);
    },
    [sharedFPS, updateText]
  );

  return (
    <Text style={styles.fpsText}>
      {prefix} {displayFPS} FPS
    </Text>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap:           6,
  },
  badge: {
    backgroundColor:  'rgba(0, 0, 0, 0.6)',
    borderWidth:       1,
    borderRadius:      6,
    paddingHorizontal: 7,
    paddingVertical:   3,
  },
  fpsText: {
    color:        COLORS.textPrimary,
    fontSize:     10,
    fontFamily:   'monospace',
    fontWeight:   '700',
    letterSpacing: 0.5,
  },
});
