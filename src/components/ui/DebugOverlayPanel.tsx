/**
 * DebugOverlayPanel.tsx
 *
 * Semi-transparent HUD showing live pipeline metrics.
 * Positioned bottom-left so it doesn't obscure the detection region.
 *
 * Performance note:
 * - This component re-renders at most 5 Hz (enforced by useDebugOverlay).
 * - All text nodes are pre-allocated — no dynamic string allocation on the
 *   render-critical path.
 */
import React, { memo } from 'react';
import { StyleSheet, View, Text } from 'react-native';
import type { DebugMetrics } from '../../hooks/useDebugOverlay';
import { COLORS } from '../../constants';

interface Props {
  metrics: DebugMetrics;
  visible: boolean;
  formatLabel: string;
}

// Memoized so parent re-renders don't cascade here unless metrics change
export const DebugOverlayPanel = memo(function DebugOverlayPanel({
  metrics,
  visible,
  formatLabel,
}: Props) {
  if (!visible) return null;

  const {
    cameraFPS, processFPS,
    totalFrames, scannedFrames, skippedFrames, skipRate,
    detectionStatus, markerId, confidence,
  } = metrics;

  return (
    <View style={styles.panel} pointerEvents="none">
      <Text style={styles.header}>◈ DEBUG</Text>

      <Row label="Format" value={formatLabel} />
      <Divider />
      <Row label="Cam FPS" value={`${cameraFPS}`} color={fpsColor(cameraFPS)} />
      <Row label="Proc FPS" value={`${processFPS}`} color={fpsColor(processFPS)} />
      <Divider />
      <Row label="Frames" value={`${totalFrames}`} />
      <Row label="Scanned" value={`${scannedFrames}`} />
      <Row label="Skipped" value={`${skippedFrames} (${skipRate})`}
        color={skippedFrames > totalFrames * 0.5 ? COLORS.accentWarning : COLORS.textSecondary} />
      <Divider />
      <Row label="Status" value={detectionStatus.toUpperCase()}
        color={statusColor(detectionStatus)} />
      <Row label="Marker" value={markerId > 0 ? `#${markerId}` : '—'} />
      <Row label="Conf" value={confidence} />
    </View>
  );
});

// ── Sub-components ────────────────────────────────────────────────────────────

const Row = memo(function Row({
  label,
  value,
  color = COLORS.textSecondary,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, { color }]}>{value}</Text>
    </View>
  );
});

const Divider = () => <View style={styles.divider} />;

// ── Helpers ───────────────────────────────────────────────────────────────────

function fpsColor(fps: number): string {
  if (fps >= 25) return COLORS.accentPrimary;
  if (fps >= 15) return COLORS.accentWarning;
  return COLORS.accentDanger;
}

function statusColor(status: string): string {
  switch (status) {
    case 'detected': return COLORS.accentPrimary;
    case 'scanning': return COLORS.accentSecondary;
    case 'lost': return COLORS.accentWarning;
    case 'error': return COLORS.accentDanger;
    default: return COLORS.textMuted;
  }
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  panel: {
    backgroundColor: 'rgba(10, 14, 26, 0.85)',
    borderWidth: 1,
    borderColor: 'rgba(0, 191, 255, 0.3)',
    borderRadius: 8,
    padding: 10,
    minWidth: 170,
    gap: 3,
  },
  header: {
    color: COLORS.accentSecondary,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 2,
    fontFamily: 'monospace',
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  label: {
    color: COLORS.textMuted,
    fontSize: 10,
    fontFamily: 'monospace',
    minWidth: 52,
  },
  value: {
    fontSize: 10,
    fontFamily: 'monospace',
    fontWeight: '600',
    textAlign: 'right',
    flexShrink: 1,
  },
  divider: {
    height: 0.5,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginVertical: 3,
  },
});
