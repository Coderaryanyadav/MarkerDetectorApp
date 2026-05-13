/**
 * useCameraPermission — wraps react-native-permissions for camera access.
 * Provides a clean, promise-based API for requesting permissions.
 */
import { useState, useCallback, useEffect } from 'react';
import { Platform } from 'react-native';
import {
  check,
  request,
  PERMISSIONS,
  RESULTS,
  PermissionStatus,
} from 'react-native-permissions';

export type PermissionState =
  | 'unknown'
  | 'checking'
  | 'granted'
  | 'denied'
  | 'blocked';

export function useCameraPermission() {
  const [permissionState, setPermissionState] =
    useState<PermissionState>('unknown');

  const checkPermission = useCallback(async () => {
    setPermissionState('checking');
    try {
      const permission = Platform.select({
        android: PERMISSIONS.ANDROID.CAMERA,
        default: PERMISSIONS.ANDROID.CAMERA,
      });

      const result: PermissionStatus = await check(permission);

      switch (result) {
        case RESULTS.GRANTED:
          setPermissionState('granted');
          break;
        case RESULTS.DENIED:
          setPermissionState('denied');
          break;
        case RESULTS.BLOCKED:
        case RESULTS.UNAVAILABLE:
          setPermissionState('blocked');
          break;
        default:
          setPermissionState('denied');
      }
    } catch (err) {
      console.error('[useCameraPermission] check failed:', err);
      setPermissionState('denied');
    }
  }, []);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    try {
      const permission = Platform.select({
        android: PERMISSIONS.ANDROID.CAMERA,
        default: PERMISSIONS.ANDROID.CAMERA,
      });

      const result: PermissionStatus = await request(permission);
      const granted = result === RESULTS.GRANTED;
      setPermissionState(granted ? 'granted' : 'denied');
      return granted;
    } catch (err) {
      console.error('[useCameraPermission] request failed:', err);
      setPermissionState('denied');
      return false;
    }
  }, []);

  // Check on mount
  useEffect(() => {
    checkPermission();
  }, [checkPermission]);

  return {
    permissionState,
    isGranted: permissionState === 'granted',
    checkPermission,
    requestPermission,
  };
}
