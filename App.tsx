/**
 * Shown when Expo is started from the monorepo root.
 * Expo Router needs to run from apps/mobile to set up the route tree.
 * Use: npm run start  (or: cd apps/mobile && npx expo start)
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Golden Flop</Text>
      <Text style={styles.message}>
        Run the app from the mobile directory:{'\n\n'}npm run start{'\n\n'}or{'\n\n'}cd apps/mobile && npx expo start
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a0a2e',
    padding: 24,
  },
  title: { color: '#FFD700', fontSize: 24, marginBottom: 24, fontWeight: 'bold' },
  message: { color: '#fff', fontSize: 14, textAlign: 'center', lineHeight: 22 },
});
