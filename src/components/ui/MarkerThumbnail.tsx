/**
 * MarkerThumbnail.tsx — Individual 300×300 marker card for the gallery grid.
 *
 * Features:
 * - Base64 image rendering (no file I/O needed)
 * - Confidence badge
 * - Index label
 * - Marker ID
 * - Entrance animation (staggered fade-in)
 * - Press feedback (scale down)
 */
import React, { memo, useEffect } from 'react';
import { StyleSheet, View, Text, Image, Pressable } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withDelay,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import type { CollectedMarker } from '../../types';
import { COLORS } from '../../constants';

interface MarkerThumbnailProps {
  marker:   CollectedMarker;
  onPress?: (marker: CollectedMarker) => void;
}

export const MarkerThumbnail = memo(function MarkerThumbnail({
  marker,
  onPress,
}: MarkerThumbnailProps) {
  // Staggered entrance animation
  const opacity = useSharedValue(0);
  const scale   = useSharedValue(0.85);

  useEffect(() => {
    const delay = (marker.index - 1) * 60;  // 60ms stagger per card
    opacity.value = withDelay(delay, withTiming(1, { duration: 400 }));
    scale.value   = withDelay(
      delay,
      withTiming(1, { duration: 400, easing: Easing.out(Easing.back(1.5)) })
    );
  }, [marker.index, opacity, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  const confPct = Math.round(marker.confidence * 100);
  const isHigh  = marker.confidence >= 0.8;

  return (
    <Animated.View style={[styles.cardOuter, animatedStyle]}>
      <Pressable
        style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
        onPress={() => onPress?.(marker)}
        accessibilityLabel={`Marker ${marker.index}, confidence ${confPct}%`}
      >
        {/* Image */}
        <Image
          source={{ uri: `data:image/jpeg;base64,${marker.imageBase64}` }}
          style={styles.image}
          resizeMode="cover"
        />

        {/* Index badge (top-left) */}
        <View style={styles.indexBadge}>
          <Text style={styles.indexText}>{marker.index}</Text>
        </View>

        {/* Confidence badge (top-right) */}
        <View
          style={[
            styles.confBadge,
            { backgroundColor: isHigh ? COLORS.accentPrimary : COLORS.accentWarning },
          ]}
        >
          <Text style={styles.confText}>{confPct}%</Text>
        </View>

        {/* Bottom info bar */}
        <View style={styles.infoBar}>
          <Text style={styles.markerIdText}>M{marker.markerId}</Text>
          <Text style={styles.timeText}>{marker.processingTimeMs}ms</Text>
        </View>
      </Pressable>
    </Animated.View>
  );
});

const CARD_SIZE = 150;  // Each card is 150×150 on screen (content is 300×300)

const styles = StyleSheet.create({
  cardOuter: {
    margin: 4,
  },
  card: {
    width:           CARD_SIZE,
    height:          CARD_SIZE,
    borderRadius:    12,
    overflow:        'hidden',
    backgroundColor: COLORS.bgCard,
    borderWidth:     1,
    borderColor:     'rgba(255,255,255,0.06)',
    elevation:       4,
    shadowColor:     '#000',
    shadowOffset:    { width: 0, height: 2 },
    shadowOpacity:   0.25,
    shadowRadius:    6,
  },
  cardPressed: {
    transform: [{ scale: 0.95 }],
    opacity:   0.85,
  },
  image: {
    width:  '100%',
    height: '100%',
  },

  // Badges
  indexBadge: {
    position:        'absolute',
    top:              6,
    left:             6,
    width:            24,
    height:           24,
    borderRadius:     12,
    backgroundColor:  'rgba(0,0,0,0.7)',
    justifyContent:   'center',
    alignItems:       'center',
    borderWidth:       1,
    borderColor:      'rgba(255,255,255,0.15)',
  },
  indexText: {
    color:      COLORS.textPrimary,
    fontSize:   10,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  confBadge: {
    position:        'absolute',
    top:              6,
    right:            6,
    paddingHorizontal: 5,
    paddingVertical:   2,
    borderRadius:      6,
  },
  confText: {
    color:      '#000',
    fontSize:   9,
    fontWeight: '800',
    fontFamily: 'monospace',
  },

  // Info bar
  infoBar: {
    position:        'absolute',
    bottom:           0,
    left:             0,
    right:            0,
    flexDirection:    'row',
    justifyContent:   'space-between',
    alignItems:       'center',
    paddingHorizontal: 8,
    paddingVertical:    4,
    backgroundColor:  'rgba(0,0,0,0.65)',
  },
  markerIdText: {
    color:      COLORS.accentSecondary,
    fontSize:   9,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  timeText: {
    color:      COLORS.textMuted,
    fontSize:   8,
    fontFamily: 'monospace',
  },
});
