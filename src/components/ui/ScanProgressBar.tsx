/**
 * ScanProgressBar.tsx — Shows X/20 collection progress.
 *
 * Features:
 * - Animated fill bar (springs on each new capture)
 * - Numeric counter (12 / 20)
 * - Percentage label
 * - "COMPLETE" state with success color
 * - Duplicate rejection counter
 */
import React, { memo, useEffect } from 'react';
import { StyleSheet, View, Text } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useCollectionProgress } from '../../hooks/useMarkerCollection';
import { COLORS } from '../../constants';

export const ScanProgressBar = memo(function ScanProgressBar() {
  const { current, target, percent, isComplete, duplicatesRejected } =
    useCollectionProgress();

  const fillWidth = useSharedValue(0);
  const pulseOpacity = useSharedValue(1);

  useEffect(() => {
    fillWidth.value = withSpring(percent, {
      damping: 15,
      stiffness: 120,
    });
  }, [percent, fillWidth]);

  // Pulse effect on new capture
  useEffect(() => {
    if (current > 0) {
      pulseOpacity.value = withTiming(0.4, { duration: 100 }, () => {
        pulseOpacity.value = withTiming(1, { duration: 300 });
      });
    }
  }, [current, pulseOpacity]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${fillWidth.value}%` as any,
    opacity: pulseOpacity.value,
  }));

  const barColor = isComplete ? COLORS.accentPrimary : COLORS.accentSecondary;

  return (
    <View style={styles.container}>
      {/* Header row */}
      <View style={styles.headerRow}>
        <Text style={styles.label}>SCAN PROGRESS</Text>
        <Text style={[styles.counter, isComplete && styles.counterComplete]}>
          {current} / {target}
        </Text>
      </View>

      {/* Progress bar */}
      <View style={styles.trackOuter}>
        <Animated.View
          style={[
            styles.fill,
            { backgroundColor: barColor },
            fillStyle,
          ]}
        />
        {/* Percentage overlay */}
        <View style={styles.percentOverlay}>
          <Text style={styles.percentText}>
            {isComplete ? '✓ COMPLETE' : `${percent}%`}
          </Text>
        </View>
      </View>

      {/* Footer row */}
      {duplicatesRejected > 0 && (
        <View style={styles.footerRow}>
          <Text style={styles.dupeText}>
            {duplicatesRejected} duplicate{duplicatesRejected !== 1 ? 's' : ''} rejected
          </Text>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    width: '100%',
    gap: 6,
    paddingHorizontal: 16,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  label: {
    color: COLORS.textMuted,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 2,
    fontFamily: 'monospace',
  },
  counter: {
    color: COLORS.accentSecondary,
    fontSize: 14,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  counterComplete: {
    color: COLORS.accentPrimary,
  },
  trackOuter: {
    height: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 4,
    overflow: 'hidden',
    position: 'relative',
  },
  fill: {
    height: '100%',
    borderRadius: 4,
  },
  percentOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  percentText: {
    color: COLORS.textPrimary,
    fontSize: 6,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 0.5,
  },
  footerRow: {
    alignItems: 'flex-end',
  },
  dupeText: {
    color: COLORS.accentWarning,
    fontSize: 9,
    fontFamily: 'monospace',
    opacity: 0.7,
  },
});
