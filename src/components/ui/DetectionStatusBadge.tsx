/**
 * DetectionStatusBadge — compact indicator showing detection system state.
 */
import React, { useEffect, useRef } from 'react';
import { StyleSheet, View, Text, Animated } from 'react-native';
import type { DetectionStatus } from '../../types';
import { COLORS } from '../../constants';

interface Props {
  status: DetectionStatus;
}

const STATUS_CONFIG: Record<
  DetectionStatus,
  { label: string; color: string; pulse: boolean }
> = {
  idle:     { label: 'IDLE',     color: COLORS.textMuted,      pulse: false },
  scanning: { label: 'SCANNING', color: COLORS.accentSecondary, pulse: true  },
  detected: { label: 'DETECTED', color: COLORS.accentPrimary,  pulse: true  },
  lost:     { label: 'LOST',     color: COLORS.accentWarning,  pulse: false },
  error:    { label: 'ERROR',    color: COLORS.accentDanger,   pulse: false },
};

export function DetectionStatusBadge({ status }: Props) {
  const config   = STATUS_CONFIG[status] ?? STATUS_CONFIG.idle;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (config.pulse) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue:         0.3,
            duration:        600,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue:         1,
            duration:        600,
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
    }
  }, [config.pulse, pulseAnim]);

  return (
    <View
      style={[styles.badge, { borderColor: config.color }]}
      accessibilityLabel={`Detection status: ${config.label}`}
    >
      <Animated.View
        style={[
          styles.dot,
          { backgroundColor: config.color, opacity: pulseAnim },
        ]}
      />
      <Text style={[styles.label, { color: config.color }]}>
        {config.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection:  'row',
    alignItems:     'center',
    gap:            5,
    paddingHorizontal: 8,
    paddingVertical:   3,
    borderRadius:   6,
    borderWidth:    1,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  dot: {
    width:        6,
    height:       6,
    borderRadius: 3,
  },
  label: {
    fontSize:    10,
    fontWeight:  '700',
    letterSpacing: 1.2,
    fontFamily:  'monospace',
  },
});
