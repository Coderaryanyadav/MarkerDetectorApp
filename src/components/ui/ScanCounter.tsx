/**
 * ScanCounter.tsx
 *
 * Displays running counts of total frames, processed frames, and scan events.
 * All three values update independently from Animated SharedValues.
 */
import React, { memo } from 'react';
import { StyleSheet, View, Text } from 'react-native';
import Animated, {
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';
import { COLORS } from '../../constants';

interface ScanCounterProps {
  totalFrames:   SharedValue<number>;
  scannedFrames: SharedValue<number>;
  skippedFrames: SharedValue<number>;
}

export const ScanCounter = memo(function ScanCounter({
  totalFrames,
  scannedFrames,
  skippedFrames,
}: ScanCounterProps) {
  return (
    <View style={styles.container}>
      <CounterCell sharedValue={totalFrames}   label="TOTAL"   color={COLORS.textSecondary} />
      <Separator />
      <CounterCell sharedValue={scannedFrames} label="SCANNED" color={COLORS.accentSecondary} />
      <Separator />
      <CounterCell sharedValue={skippedFrames} label="SKIPPED" color={COLORS.accentWarning} />
    </View>
  );
});

// ── Sub-components ────────────────────────────────────────────────────────────

const CounterCell = memo(function CounterCell({
  sharedValue,
  label,
  color,
}: {
  sharedValue: SharedValue<number>;
  label: string;
  color: string;
}) {
  const textStyle = useAnimatedStyle(() => ({ opacity: 1 }));

  return (
    <View style={styles.cell}>
      <Animated.Text style={[styles.count, { color }, textStyle]}>
        {sharedValue.value}
      </Animated.Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
});

const Separator = () => (
  <View style={styles.separator} />
);

const styles = StyleSheet.create({
  container: {
    flexDirection:   'row',
    alignItems:      'center',
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    borderRadius:    8,
    borderWidth:     1,
    borderColor:     'rgba(255,255,255,0.08)',
    paddingHorizontal: 12,
    paddingVertical:    6,
    gap:             0,
  },
  cell: {
    alignItems: 'center',
    paddingHorizontal: 10,
    gap: 2,
  },
  count: {
    fontSize:   15,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  label: {
    fontSize:     8,
    fontWeight:   '600',
    letterSpacing: 1,
    color:        COLORS.textMuted,
    fontFamily:   'monospace',
  },
  separator: {
    width:           0.5,
    height:          28,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
});
