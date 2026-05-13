/**
 * App.tsx — Root application component.
 *
 * Sets up:
 * - GestureHandlerRootView (required by react-native-gesture-handler)
 * - SafeAreaProvider (required by react-native-safe-area-context)
 * - Navigation container
 * - Global error boundary
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';

import { CameraScreen } from './src/screens/CameraScreen';
import { ResultsGalleryScreen } from './src/screens/ResultsGalleryScreen';
import { COLORS } from './src/constants';
import type { RootStackParamList } from './src/types';

const Stack = createStackNavigator<RootStackParamList>();

export default function App(): React.JSX.Element {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <NavigationContainer>
          <Stack.Navigator
            initialRouteName="Scanner"
            screenOptions={{
              headerShown: false,
              cardStyle: { backgroundColor: COLORS.bgDeep },
              animationEnabled: true,
            }}
          >
            {/* Screen 1: Live Camera Scanner */}
            <Stack.Screen
              name="Scanner"
              component={CameraScreen}
              options={{ title: 'Marker Scanner' }}
            />

            {/* Screen 2: Results Gallery — 20 collected markers in grid */}
            <Stack.Screen
              name="Gallery"
              component={ResultsGalleryScreen}
              options={{
                title: 'Results Gallery',
                // Slide-up animation for gallery
                cardStyleInterpolator: ({ current: { progress } }) => ({
                  cardStyle: {
                    opacity: progress,
                  },
                }),
              }}
            />
          </Stack.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.bgDeep,
  },
});
