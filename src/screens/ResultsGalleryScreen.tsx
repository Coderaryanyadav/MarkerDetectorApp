/**
 * ResultsGalleryScreen.tsx — Screen 2: Grid display of 20 collected markers.
 *
 * Features:
 * - FlatList grid (2 columns) with smooth scrolling
 * - Every image exactly 300×300 (rendered at 150×150 on screen for fit)
 * - Summary statistics (total, avg confidence, avg processing time)
 * - "Rescan" button to reset collection and go back to scanner
 * - Empty state if no markers collected
 * - Staggered entrance animations
 * - Press-to-enlarge modal (full 300×300 view)
 */
import React, { useState, useCallback, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  Pressable,
  Modal,
  Image,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import Animated, {
  FadeIn,
  SlideInUp,
} from 'react-native-reanimated';

import {
  useCollectedMarkers,
  useCollectionProgress,
  useCollectionStore,
} from '../hooks/useMarkerCollection';
import { MarkerThumbnail } from '../components/ui/MarkerThumbnail';
import { COLORS } from '../constants';
import type { CollectedMarker, RootStackParamList } from '../types';

type GalleryNavProp = StackNavigationProp<RootStackParamList, 'Gallery'>;

// ─────────────────────────────────────────────────────────────────────────────
// Gallery Screen
// ─────────────────────────────────────────────────────────────────────────────

export function ResultsGalleryScreen() {
  const navigation = useNavigation<GalleryNavProp>();
  const markers    = useCollectedMarkers();
  const progress   = useCollectionProgress();
  const resetCollection = useCollectionStore((s) => s.reset);

  // ── Full-screen preview modal ─────────────────────────────────────────
  const [selectedMarker, setSelectedMarker] = useState<CollectedMarker | null>(null);

  const handleMarkerPress = useCallback((marker: CollectedMarker) => {
    setSelectedMarker(marker);
  }, []);

  const closePreview = useCallback(() => {
    setSelectedMarker(null);
  }, []);

  // ── Statistics ─────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    if (markers.length === 0) return null;

    const totalConf = markers.reduce((acc, m) => acc + m.confidence, 0);
    const totalTime = markers.reduce((acc, m) => acc + m.processingTimeMs, 0);
    const avgConf   = totalConf / markers.length;
    const avgTime   = totalTime / markers.length;
    const minConf   = Math.min(...markers.map((m) => m.confidence));
    const maxConf   = Math.max(...markers.map((m) => m.confidence));

    return {
      count:    markers.length,
      avgConf:  Math.round(avgConf * 100),
      minConf:  Math.round(minConf * 100),
      maxConf:  Math.round(maxConf * 100),
      avgTime:  Math.round(avgTime),
      totalTime: Math.round(totalTime),
    };
  }, [markers]);

  // ── Rescan handler ─────────────────────────────────────────────────────
  const handleRescan = useCallback(() => {
    resetCollection();
    navigation.goBack();
  }, [resetCollection, navigation]);

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.bgDeep} />

      {/* ── Header ── */}
      <Animated.View entering={SlideInUp.duration(400)} style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.title}>◈ RESULTS</Text>
          <Text style={styles.subtitle}>
            {progress.current} of {progress.target} markers collected
          </Text>
        </View>
        <Pressable
          style={({ pressed }) => [styles.backBtn, pressed && styles.btnPressed]}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Go back to scanner"
        >
          <Text style={styles.backBtnText}>← SCAN</Text>
        </Pressable>
      </Animated.View>

      {/* ── Statistics Bar ── */}
      {stats && (
        <Animated.View entering={FadeIn.delay(200).duration(400)} style={styles.statsBar}>
          <StatCell label="COUNT" value={`${stats.count}`} />
          <StatDivider />
          <StatCell label="AVG CONF" value={`${stats.avgConf}%`} color={COLORS.accentPrimary} />
          <StatDivider />
          <StatCell label="MIN" value={`${stats.minConf}%`} color={COLORS.accentWarning} />
          <StatDivider />
          <StatCell label="MAX" value={`${stats.maxConf}%`} color={COLORS.accentPrimary} />
          <StatDivider />
          <StatCell label="AVG TIME" value={`${stats.avgTime}ms`} />
        </Animated.View>
      )}

      {/* ── Duplicate rejection counter ── */}
      {progress.duplicatesRejected > 0 && (
        <View style={styles.dupeRow}>
          <Text style={styles.dupeText}>
            🚫 {progress.duplicatesRejected} duplicate frame{progress.duplicatesRejected !== 1 ? 's' : ''} rejected
          </Text>
        </View>
      )}

      {/* ── Marker Grid ── */}
      {markers.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>◎</Text>
          <Text style={styles.emptyTitle}>No markers collected yet</Text>
          <Text style={styles.emptyDesc}>
            Point your camera at a marker to start scanning.
            The app will automatically capture 20 unique detections.
          </Text>
          <Pressable
            style={({ pressed }) => [styles.goScanBtn, pressed && styles.btnPressed]}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.goScanBtnText}>Start Scanning</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={markers}
          keyExtractor={(item) => item.id}
          numColumns={2}
          columnWrapperStyle={styles.gridRow}
          contentContainerStyle={styles.gridContent}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <MarkerThumbnail marker={item} onPress={handleMarkerPress} />
          )}
          // Performance optimizations
          removeClippedSubviews={true}
          maxToRenderPerBatch={6}
          windowSize={5}
          initialNumToRender={10}
        />
      )}

      {/* ── Rescan button (shown when collection complete) ── */}
      {progress.isComplete && (
        <Animated.View entering={FadeIn.delay(500).duration(400)} style={styles.rescanRow}>
          <Pressable
            style={({ pressed }) => [styles.rescanBtn, pressed && styles.btnPressed]}
            onPress={handleRescan}
            accessibilityRole="button"
            accessibilityLabel="Reset collection and rescan"
          >
            <Text style={styles.rescanBtnText}>↻ RESCAN (Reset Collection)</Text>
          </Pressable>
        </Animated.View>
      )}

      {/* ── Full-screen preview modal ── */}
      <Modal
        visible={!!selectedMarker}
        transparent
        animationType="fade"
        onRequestClose={closePreview}
      >
        <Pressable style={styles.modalBackdrop} onPress={closePreview}>
          <View style={styles.modalContent}>
            {selectedMarker && (
              <>
                <Image
                  source={{
                    uri: `data:image/jpeg;base64,${selectedMarker.imageBase64}`,
                  }}
                  style={styles.modalImage}
                  resizeMode="contain"
                />
                <View style={styles.modalInfo}>
                  <Text style={styles.modalTitle}>
                    Marker #{selectedMarker.index} — M{selectedMarker.markerId}
                  </Text>
                  <Text style={styles.modalDetail}>
                    Confidence: {Math.round(selectedMarker.confidence * 100)}%
                    {'  |  '}
                    Processing: {selectedMarker.processingTimeMs}ms
                  </Text>
                  <Text style={styles.modalDetail}>
                    Hash: {selectedMarker.perceptualHash}
                  </Text>
                  <Text style={styles.modalDetail}>
                    300 × 300 px — JPEG
                  </Text>
                </View>
              </>
            )}
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

const StatCell = React.memo(function StatCell({
  label,
  value,
  color = COLORS.textSecondary,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <View style={styles.statCell}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
});

const StatDivider = () => <View style={styles.statDivider} />;

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex:             1,
    backgroundColor:  COLORS.bgDeep,
  },

  // Header
  header: {
    flexDirection:   'row',
    justifyContent:  'space-between',
    alignItems:      'center',
    paddingHorizontal: 20,
    paddingVertical:   14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  headerLeft: { gap: 4 },
  title: {
    color:         COLORS.textPrimary,
    fontSize:      16,
    fontWeight:    '800',
    letterSpacing:  2.5,
    fontFamily:    'monospace',
  },
  subtitle: {
    color:    COLORS.textMuted,
    fontSize: 11,
    fontFamily: 'monospace',
  },
  backBtn: {
    paddingHorizontal: 14,
    paddingVertical:    8,
    borderRadius:       8,
    borderWidth:        1,
    borderColor:        COLORS.accentSecondary,
  },
  backBtnText: {
    color:         COLORS.accentSecondary,
    fontSize:      11,
    fontWeight:    '700',
    fontFamily:    'monospace',
    letterSpacing:  1,
  },
  btnPressed: { opacity: 0.7, transform: [{ scale: 0.96 }] },

  // Stats bar
  statsBar: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: COLORS.bgCard,
    marginHorizontal: 16,
    marginTop:        12,
    borderRadius:     10,
    borderWidth:       1,
    borderColor:      'rgba(255,255,255,0.06)',
  },
  statCell: {
    alignItems:      'center',
    paddingHorizontal: 8,
    gap:              2,
  },
  statValue: {
    fontSize:   13,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  statLabel: {
    color:         COLORS.textMuted,
    fontSize:       7,
    fontWeight:    '600',
    letterSpacing:  1,
    fontFamily:    'monospace',
  },
  statDivider: {
    width:            0.5,
    height:           24,
    backgroundColor:  'rgba(255,255,255,0.1)',
  },

  // Duplicate row
  dupeRow: {
    alignItems:      'center',
    paddingVertical: 6,
  },
  dupeText: {
    color:    COLORS.accentWarning,
    fontSize: 10,
    fontFamily: 'monospace',
    opacity:  0.8,
  },

  // Grid
  gridContent: {
    paddingHorizontal: 12,
    paddingTop:        12,
    paddingBottom:     100,
  },
  gridRow: {
    justifyContent: 'center',
    gap:             8,
  },

  // Empty state
  emptyState: {
    flex:           1,
    justifyContent: 'center',
    alignItems:     'center',
    paddingHorizontal: 40,
    gap:             20,
  },
  emptyIcon: {
    fontSize:  60,
    color:     COLORS.textMuted,
  },
  emptyTitle: {
    color:      COLORS.textPrimary,
    fontSize:   20,
    fontWeight: '700',
    textAlign:  'center',
  },
  emptyDesc: {
    color:      COLORS.textSecondary,
    fontSize:   13,
    textAlign:  'center',
    lineHeight: 22,
  },
  goScanBtn: {
    backgroundColor:   COLORS.accentPrimary,
    paddingHorizontal: 32,
    paddingVertical:   12,
    borderRadius:      12,
  },
  goScanBtnText: {
    color:      COLORS.bgDeep,
    fontSize:   14,
    fontWeight: '700',
  },

  // Rescan row
  rescanRow: {
    position:     'absolute',
    bottom:        20,
    left:          20,
    right:         20,
  },
  rescanBtn: {
    backgroundColor:   COLORS.accentSecondary,
    paddingVertical:    14,
    borderRadius:       14,
    alignItems:         'center',
  },
  rescanBtnText: {
    color:          COLORS.bgDeep,
    fontSize:       13,
    fontWeight:     '800',
    fontFamily:     'monospace',
    letterSpacing:   1,
  },

  // Modal
  modalBackdrop: {
    flex:            1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent:  'center',
    alignItems:      'center',
  },
  modalContent: {
    alignItems: 'center',
    gap:         20,
    padding:     20,
  },
  modalImage: {
    width:        300,
    height:       300,
    borderRadius: 8,
    borderWidth:   2,
    borderColor:  COLORS.accentPrimary,
  },
  modalInfo: {
    alignItems: 'center',
    gap:         6,
  },
  modalTitle: {
    color:      COLORS.textPrimary,
    fontSize:   16,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  modalDetail: {
    color:    COLORS.textSecondary,
    fontSize: 11,
    fontFamily: 'monospace',
  },
});
