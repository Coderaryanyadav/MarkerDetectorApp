/**
 * useHapticFeedback — wraps react-native-haptic-feedback with typed presets
 * for different detection events.
 *
 * Haptic patterns:
 * - onDetect: light tap — marker found
 * - onHighConfidence: medium impact — strong match
 * - onLost: soft tap — marker lost
 * - onError: error pattern — detection failure
 */
import { useCallback } from 'react';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';

const hapticOptions = {
  enableVibrateFallback: true,
  ignoreAndroidSystemSettings: false,
};

export function useHapticFeedback() {
  const onDetect = useCallback(() => {
    ReactNativeHapticFeedback.trigger('impactLight', hapticOptions);
  }, []);

  const onHighConfidence = useCallback(() => {
    ReactNativeHapticFeedback.trigger('impactMedium', hapticOptions);
  }, []);

  const onLost = useCallback(() => {
    ReactNativeHapticFeedback.trigger('selection', hapticOptions);
  }, []);

  const onError = useCallback(() => {
    ReactNativeHapticFeedback.trigger('notificationError', hapticOptions);
  }, []);

  const onSuccess = useCallback(() => {
    ReactNativeHapticFeedback.trigger('notificationSuccess', hapticOptions);
  }, []);

  return { onDetect, onHighConfidence, onLost, onError, onSuccess };
}
