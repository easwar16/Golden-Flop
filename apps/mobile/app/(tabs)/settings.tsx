/**
 * Settings screen – username and avatar management.
 */

import {
  useFonts,
  PressStart2P_400Regular,
} from '@expo-google-fonts/press-start-2p';
import * as SplashScreen from 'expo-splash-screen';
import { useRouter, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Image,
  ImageBackground,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import PixelAvatar from '@/components/PixelAvatar';
import { useUserStore } from '@/stores/useUserStore';
import { useWallet } from '@/contexts/wallet-context';
import { PublicKey } from '@solana/web3.js';

const gold = '#FFD700';
const panelBg = 'rgba(81, 46, 123, 0.92)';

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { connectWallet } = useLocalSearchParams<{ connectWallet?: string }>();
  const { username, avatarSeed, setUsername, regenerateAvatar } = useUserStore();
  const { accounts, authorize, deauthorize, isLoading: walletLoading, error: walletError } = useWallet();
  const isWalletConnected = !!accounts?.length;
  const [draft, setDraft] = useState(username);
  const scrollRef = useRef<ScrollView>(null);
  const walletPromptAnim = useRef(new Animated.Value(0)).current;

  const [fontsLoaded, fontError] = useFonts({ PressStart2P_400Regular });
  const onLayoutRoot = useCallback(async () => {
    if (fontsLoaded || fontError) await SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  // Scroll to wallet section and pulse it when redirected from lobby
  useEffect(() => {
    if (connectWallet !== '1') return;
    const timer = setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
      Animated.sequence([
        Animated.timing(walletPromptAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.delay(2500),
        Animated.timing(walletPromptAnim, { toValue: 0, duration: 400, useNativeDriver: true }),
      ]).start();
    }, 400);
    return () => clearTimeout(timer);
  }, [connectWallet, walletPromptAnim]);

  const blinkAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(blinkAnim, { toValue: 0.15, duration: 600, useNativeDriver: true }),
        Animated.timing(blinkAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [blinkAnim]);

  const toastOpacity = useRef(new Animated.Value(0)).current;
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback(() => {
    Animated.sequence([
      Animated.timing(toastOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.delay(1400),
      Animated.timing(toastOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start();
  }, [toastOpacity]);

  const saveUsername = useCallback((value: string) => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      setUsername(value);
      Keyboard.dismiss();
      showToast();
    }, 2000);
  }, [setUsername, showToast]);

  const handleDraftChange = useCallback((value: string) => {
    setDraft(value);
    saveUsername(value);
  }, [saveUsername]);

  const handleNewAvatar = useCallback(() => {
    regenerateAvatar();
  }, [regenerateAvatar]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <View style={styles.container} onLayout={onLayoutRoot}>
        <ImageBackground
          source={require('@/assets/images/lobby-bg.png')}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
        />

        <View style={[styles.content, { paddingTop: insets.top + 28 }]}>
          <View style={styles.header}>
            <Pressable style={styles.backBtn} onPress={() => router.push('/(tabs)')}>
              <Text style={styles.backBtnText}>{'<'}</Text>
            </Pressable>
            <Text style={styles.title}>PROFILE</Text>
            <View style={styles.backBtnPlaceholder} />
          </View>

          <ScrollView
            ref={scrollRef}
            style={styles.scroll}
            contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 32 }]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled">

            {/* Avatar */}
            <View style={styles.avatarSection}>
              <View style={styles.avatarWrap}>
                <PixelAvatar seed={avatarSeed} size={100} borderRadius={50} />
              </View>
              <Pressable
                style={({ pressed }) => [styles.regenBtn, pressed && styles.regenBtnPressed]}
                onPress={handleNewAvatar}>
                <Text style={styles.regenBtnText}>NEW AVATAR</Text>
              </Pressable>
            </View>

            {/* Username */}
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>USERNAME</Text>
              <TextInput
                style={styles.input}
                value={draft}
                onChangeText={handleDraftChange}
                returnKeyType="done"
                maxLength={16}
                autoCapitalize="none"
                autoCorrect={false}
                placeholderTextColor="rgba(255,255,255,0.4)"
                placeholder="Enter username"
              />
            </View>

            {/* Wallet */}
            <View style={styles.walletSpacer} />
            <View style={styles.walletCardShadow}>
            <ImageBackground
              source={require('@/assets/images/wallet-background.png')}
              style={styles.walletCard}
              resizeMode="stretch"
              imageStyle={styles.walletCardBg}>
              <View style={styles.walletCardInner}>
                <View style={styles.walletCardHeader}>
                  <Image source={require('@/assets/images/wallet-icon.png')} style={styles.walletIcon} resizeMode="contain" />
                  <Text style={styles.walletCardTitle}>WALLET</Text>
                </View>
                {isWalletConnected ? (
                  <>
                    <View style={styles.walletConnectedRow}>
                      <View style={styles.walletConnectedStatus}>
                        <View style={styles.walletConnectedDot} />
                        <Text style={styles.walletConnectedText}>CONNECTED</Text>
                      </View>
                      <Pressable
                        style={({ pressed }) => [styles.disconnectBtn, pressed && { opacity: 0.7 }]}
                        onPress={deauthorize}
                        disabled={walletLoading}>
                        <Text style={styles.disconnectBtnText}>
                          {walletLoading ? 'DISCONNECTING…' : 'DISCONNECT'}
                        </Text>
                      </Pressable>
                    </View>
                    {accounts?.[0]?.address && (() => {
                      const base58 = new PublicKey(accounts[0].address).toBase58();
                      const short = base58.slice(0, 6) + '...' + base58.slice(-6);
                      return <Text style={styles.walletAddressText}>{short}</Text>;
                    })()}
                  </>
                ) : (
                  <>
                    <View style={styles.walletStatus}>
                      <Animated.View style={[styles.walletStatusDot, { opacity: blinkAnim }]} />
                      <Text style={styles.walletStatusText}>NOT CONNECTED</Text>
                    </View>
                    <Text style={styles.walletCardSub}>
                      Connect a Solana wallet to buy chips and join cash games.
                    </Text>
                    {/* Surface wallet adapter errors (e.g. dev build required) */}
                    {!!walletError && (
                      <Text style={styles.walletErrorText}>{walletError}</Text>
                    )}
                    <Pressable
                      style={[styles.connectBtn, walletLoading && { opacity: 0.6 }]}
                      onPress={authorize}
                      disabled={walletLoading}>
                      {({ pressed }) => (
                        <ImageBackground
                          source={pressed
                            ? require('@/assets/images/buttons/connect-btn-pressed.png')
                            : require('@/assets/images/buttons/connect-btn.png')}
                          style={styles.connectBtnBg}
                          resizeMode="stretch">
                          <Text style={styles.connectBtnText}>
                            {walletLoading ? 'CONNECTING…' : 'CONNECT'}
                          </Text>
                        </ImageBackground>
                      )}
                    </Pressable>
                  </>
                )}
              </View>
            </ImageBackground>
            </View>
            {/* Prompt banner — appears below wallet card when redirected from lobby */}
            <Animated.View style={[styles.walletPromptBanner, { opacity: walletPromptAnim }]} pointerEvents="none">
              <Text style={styles.walletPromptText}>⚠ Connect your wallet to join a table</Text>
            </Animated.View>

          </ScrollView>
        </View>
      <Animated.View style={[styles.toast, { opacity: toastOpacity, bottom: insets.bottom + 32 }]} pointerEvents="none">
        <Text style={styles.toastText}>✓ Saved</Text>
      </Animated.View>
      </View>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    flex: 1,
    paddingHorizontal: 24,
  },
  scroll: { flex: 1 },
  scrollContent: {
    alignItems: 'center',
    gap: 20,
    paddingTop: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 4,
  },
  backBtn: {
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  backBtnText: {
    fontFamily: 'PressStart2P_400Regular',
    fontSize: 14,
    color: gold,
  },
  backBtnPlaceholder: {
    width: 30,
  },
  title: {
    fontFamily: 'PressStart2P_400Regular',
    fontSize: Platform.OS === 'web' ? 18 : 16,
    color: gold,
    letterSpacing: 2,
  },
  avatarSection: { alignItems: 'center', gap: 12, alignSelf: 'center',marginTop:40, width: '60%' },
  avatarWrap: {
    borderRadius: 55,
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
    marginVertical:20,
    borderWidth: 2,
    borderColor: gold,
    borderRadius: 12,
    paddingVertical: 9,
    paddingHorizontal: 18,
  },
  regenBtnPressed: { opacity: 0.85 },
  regenBtnText: {
    fontFamily: 'PressStart2P_400Regular',
    fontSize: Platform.OS === 'web' ? 10 : 9,
    color: gold,
    letterSpacing: 1,
  },
  field: { width: '100%', gap: 8 },
  walletSpacer: { height: 16 },
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

  walletPromptBanner: {
    width: '100%',
    backgroundColor: 'rgba(255, 59, 59, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255, 59, 59, 0.5)',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  walletPromptText: {
    fontFamily: 'PressStart2P_400Regular',
    fontSize: 7,
    color: '#FF6B6B',
    lineHeight: 14,
    textAlign: 'center',
  },

  // Wallet card
  walletCardShadow: {
    width: '100%',
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.45)',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.6, shadowRadius: 20 },
      android: { elevation: 16 },
      default: {},
    }),
  },
  walletCard: {
    width: '100%',
  },
  walletCardBg: {},
  walletCardInner: {
    paddingHorizontal: 28,
    paddingTop: 22,
    marginHorizontal:30,
    marginVertical:20,
    paddingBottom: 26,
    gap: 12,
  },
  walletCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop:25,
    gap: 10,
  },
  walletIcon: { width: 36, height: 36 },
  walletCardTitle: {
    marginTop:8,
    fontFamily: 'PressStart2P_400Regular',
    fontSize: Platform.OS === 'web' ? 13 : 12,
    color: gold,
    letterSpacing: 1,
  },
  walletStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    flex:1,
    gap: 8,
  },
  walletConnectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  walletConnectedStatus: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  walletConnectedDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 10,
    backgroundColor: '#22c55e',
    ...Platform.select({
      ios: { shadowColor: '#22c55e', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 1, shadowRadius: 6 },
      android: {},
      default: {},
    }),
  },
  walletConnectedText: {
    fontFamily: 'PressStart2P_400Regular',
    fontSize: 11,
    marginTop:4,
    color: '#4ADE80',
    letterSpacing: 1,
    ...Platform.select({
      ios: { textShadowColor: '#22c55e', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 8 },
      android: {},
      default: {},
    }),
  },
  walletAddressText: {
    fontFamily: 'PressStart2P_400Regular',
    fontSize: 8,
    color: 'rgba(255,255,255,0.5)',
    letterSpacing: 1,
    marginTop: 6,
  },
  walletStatusDot: {
    marginBottom:5,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#FF3B3B',
    ...Platform.select({
      ios: { shadowColor: '#FF0000', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 1, shadowRadius: 6 },
      android: { elevation: 4 },
      default: {},
    }),
  },
  walletStatusText: {
    fontFamily: 'PressStart2P_400Regular',
    alignItems:'center',
    justifyContent:'center',
    flex:1,
    fontSize: 8,
    color: '#FF6B6B',
    letterSpacing: 0.5,
  },
  walletCardSub: {
    fontFamily: 'PressStart2P_400Regular',
    fontSize: 7,
    color: 'rgba(255,235,180,0.9)',
    lineHeight: 14,
  },
  connectBtn: {
    width: '85%',
    overflow: 'hidden',
    alignSelf: 'center',
  },
  connectBtnBg: {
    paddingVertical: 25,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom : 20,
  },
  connectBtnText: {
    fontFamily: 'PressStart2P_400Regular',
    fontSize: Platform.OS === 'web' ? 11 : 10,
    color: '#fff',
    letterSpacing: 1,
  },
  disconnectBtn: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,59,59,0.5)',
    borderRadius: 8,
    backgroundColor: 'rgba(255,59,59,0.1)',
  },
  disconnectBtnText: {
    fontFamily: 'PressStart2P_400Regular',
    fontSize: 6,
    color: '#FF6B6B',
    letterSpacing: 1,
  },
  walletErrorText: {
    fontFamily: 'PressStart2P_400Regular',
    fontSize: 7,
    color: '#FF6B6B',
    lineHeight: 13,
    textAlign: 'center',
  },

  // Toast
  toast: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: 'rgba(26,10,46,0.95)',
    borderWidth: 1.5,
    borderColor: gold,
    borderRadius: 20,
    paddingVertical: 10,
    paddingHorizontal: 22,
    zIndex: 999,
    ...Platform.select({
      ios: { shadowColor: gold, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.4, shadowRadius: 8 },
      android: { elevation: 10 },
      default: {},
    }),
  },
  toastText: {
    fontFamily: 'PressStart2P_400Regular',
    fontSize: 9,
    color: gold,
    letterSpacing: 1,
  },
});
