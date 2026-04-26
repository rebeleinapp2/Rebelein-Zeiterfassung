import { useCallback } from 'react';

/**
 * Hook for haptic feedback using the Web Vibration API.
 * Safely handles environments where vibration is not supported.
 */
export const useHapticFeedback = () => {
  const vibrate = useCallback((pattern: number | number[]) => {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try {
        navigator.vibrate(pattern);
      } catch (e) {
        // Ignore vibration errors
      }
    }
  }, []);

  const impactLight = useCallback(() => vibrate(10), [vibrate]);
  const impactMedium = useCallback(() => vibrate(20), [vibrate]);
  const impactHeavy = useCallback(() => vibrate(50), [vibrate]);
  const notificationSuccess = useCallback(() => vibrate([10, 30, 10]), [vibrate]);
  const notificationWarning = useCallback(() => vibrate([30, 40, 30, 40]), [vibrate]);
  const notificationError = useCallback(() => vibrate([50, 100, 50, 100]), [vibrate]);

  return {
    vibrate,
    impactLight,
    impactMedium,
    impactHeavy,
    notificationSuccess,
    notificationWarning,
    notificationError,
  };
};
