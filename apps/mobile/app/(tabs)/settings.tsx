/**
 * Settings screen – username and avatar management.
 */

import {
  useFonts,
  PressStart2P_400Regular,
} from '@expo-google-fonts/press-start-2p';
import * as SplashScreen from 'expo-splash-screen';
import React, { useCallback, useState } from 'react';
import {
  ImageBackground,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import PixelAvatar from '@/components/PixelAvatar';
import { useUserStore } from '@/stores/useUserStore';

const gold = '#FFD700';
const panelBg = 'rgba(81, 46, 123, 0.92)';

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { username, avatarSeed, setUsername, regenerateAvatar } = useUserStore();
  const [draft, setDraft] = useState(username);

  const [fontsLoaded, fontError] = useFonts({ PressStart2P_400Regular });
  const onLayoutRoot = useCallback(async () => {
    if (fontsLoaded || fontError) await SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  const handleSave = () => {
    setUsername(draft);
    Keyboard.dismiss();
  };

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <View style={styles.container} onLayout={onLayoutRoot}>
        <ImageBackground
          source={require('@/assets/images/lobby-bg.png')}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
        />

        <View style={[styles.content, { paddingTop: insets.top + 28, paddingBottom: insets.bottom + 24 }]}>
          <Text style={styles.title}>PROFILE</Text>

          {/* Avatar */}
          <View style={styles.avatarSection}>
            <View style={styles.avatarWrap}>
              <PixelAvatar seed={avatarSeed} size={120} borderRadius={60} />
            </View>
            <Pressable
              style={({ pressed }) => [styles.regenBtn, pressed && styles.regenBtnPressed]}
              onPress={regenerateAvatar}>
              <Text style={styles.regenBtnText}>NEW AVATAR</Text>
            </Pressable>
          </View>

          {/* Username */}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>USERNAME</Text>
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={handleSave}
              returnKeyType="done"
              maxLength={16}
              autoCapitalize="none"
              autoCorrect={false}
              placeholderTextColor="rgba(255,255,255,0.4)"
              placeholder="Enter username"
            />
            <Pressable
              style={({ pressed }) => [styles.saveBtn, pressed && styles.saveBtnPressed]}
              onPress={handleSave}>
              <Text style={styles.saveBtnText}>SAVE</Text>
            </Pressable>
          </View>

          {/* Current values */}
          <View style={styles.infoPanel}>
            <Text style={styles.infoRow}>
              <Text style={styles.infoLabel}>Name  </Text>
              <Text style={styles.infoValue}>{username}</Text>
            </Text>
            <Text style={styles.infoRow}>
              <Text style={styles.infoLabel}>Seed  </Text>
              <Text style={styles.infoValue}>{avatarSeed}</Text>
            </Text>
          </View>
        </View>
      </View>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    alignItems: 'center',
    gap: 24,
  },
  title: {
    fontFamily: 'PressStart2P_400Regular',
    fontSize: Platform.OS === 'web' ? 18 : 16,
    color: gold,
    letterSpacing: 2,
    marginBottom: 8,
  },
  avatarSection: { alignItems: 'center', gap: 16 },
  avatarWrap: {
    borderRadius: 60,
    borderWidth: 3,
    borderColor: gold,
    overflow: 'hidden',
    ...Platform.select({
      ios: { shadowColor: gold, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 10 },
      android: { elevation: 8 },
      default: {},
    }),
  },
  regenBtn: {
    backgroundColor: panelBg,
    borderWidth: 2,
    borderColor: gold,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  regenBtnPressed: { opacity: 0.85 },
  regenBtnText: {
    fontFamily: 'PressStart2P_400Regular',
    fontSize: Platform.OS === 'web' ? 10 : 9,
    color: gold,
    letterSpacing: 1,
  },
  field: { width: '100%', gap: 10 },
  fieldLabel: {
    fontFamily: 'PressStart2P_400Regular',
    fontSize: 9,
    color: 'rgba(255,255,255,0.7)',
    letterSpacing: 1,
  },
  input: {
    fontFamily: 'PressStart2P_400Regular',
    fontSize: 12,
    color: '#fff',
    borderWidth: 1.5,
    borderColor: 'rgba(255,215,0,0.5)',
    borderRadius: 10,
    padding: 12,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  saveBtn: {
    backgroundColor: panelBg,
    borderWidth: 2,
    borderColor: gold,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  saveBtnPressed: { opacity: 0.85 },
  saveBtnText: {
    fontFamily: 'PressStart2P_400Regular',
    fontSize: Platform.OS === 'web' ? 12 : 11,
    color: gold,
    letterSpacing: 1,
  },
  infoPanel: {
    width: '100%',
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.2)',
    padding: 16,
    gap: 8,
  },
  infoRow: { flexDirection: 'row' },
  infoLabel: {
    fontFamily: 'PressStart2P_400Regular',
    fontSize: 8,
    color: 'rgba(255,255,255,0.5)',
  },
  infoValue: {
    fontFamily: 'PressStart2P_400Regular',
    fontSize: 8,
    color: 'rgba(255,255,255,0.9)',
  },
});
