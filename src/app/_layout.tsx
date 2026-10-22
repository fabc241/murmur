import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { useQvacLifecycle } from '../qvac/lifecycle';
import { recoverInterruptedVisits } from '../storage/visits';
import { SERIF, useColors } from '../ui/theme';

export default function RootLayout() {
  const c = useColors();
  useQvacLifecycle();

  useEffect(() => {
    recoverInterruptedVisits().catch(() => undefined);
  }, []);

  return (
    <>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: c.paper },
          headerShadowVisible: false,
          headerTintColor: c.accent,
          headerTitleStyle: { color: c.ink, fontFamily: SERIF, fontWeight: '600' },
          headerBackButtonDisplayMode: 'minimal',
          contentStyle: { backgroundColor: c.paper },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Visits', headerLargeTitle: true, headerLargeTitleShadowVisible: false, headerLargeTitleStyle: { color: c.ink, fontFamily: SERIF } }} />
        <Stack.Screen name="setup" options={{ title: 'Set up Murmur', headerBackVisible: false, gestureEnabled: false }} />
        <Stack.Screen name="record" options={{ title: 'New visit', presentation: 'fullScreenModal', gestureEnabled: false }} />
        <Stack.Screen name="visit/[id]" options={{ title: '' }} />
      </Stack>
    </>
  );
}
