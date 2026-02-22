import {
  useFonts,
  PressStart2P_400Regular,
} from '@expo-google-fonts/press-start-2p';
import { Link, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useState } from 'react';
import {
  ImageBackground,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [hoveredBtn, setHoveredBtn] = useState<'play' | 'private' | 'leaderboard' | null>(null);
  const [playPressed, setPlayPressed] = useState(false);

  const [fontsLoaded, fontError] = useFonts({
    PressStart2P_400Regular,
  });

  const onLayoutRootView = useCallback(async () => {
    if (fontsLoaded || fontError) {
      await SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <View style={styles.container} onLayout={onLayoutRootView}>
      <ImageBackground
        source={require('@/assets/images/casino-bg.png')}
        style={StyleSheet.absoluteFill}
        resizeMode="cover"
      />
      {/* Neon accent bar */}
      <View
        style={[
          styles.neonBar,
          {
            top: insets.top,
          },
        ]}
        pointerEvents="none"
      />

      <View
        style={[
          styles.content,
          {
            paddingTop: insets.top + 16,
            paddingBottom: insets.bottom + 72,
          },
        ]}
      >
        {/* Menu buttons – wrapper View handles hover on web via mouse events */}
        <View style={styles.buttons}>
          <View
            style={[styles.btnWrapper, styles.playBtnWrapper]}
            {...({
              onMouseEnter: () => setHoveredBtn('play'),
              onMouseLeave: () => setHoveredBtn(null),
            } as any)}>
            <Link href="/(tabs)/lobby" asChild>
              <Pressable
                style={({ pressed }) => [
                  styles.btn,
                  styles.btnPlay,
                  styles.playBtnWrap,
                  hoveredBtn === 'play' && styles.btnHover,
                  pressed && styles.btnPressed,
                ]}
                onPressIn={() => setPlayPressed(true)}
                onPressOut={() => setPlayPressed(false)}>
                <View style={styles.playBtnClip}>
                  <ImageBackground
                    source={
                      playPressed
                        ? require('@/assets/images/buttons/play-btn-pressed.png')
                        : require('@/assets/images/buttons/play-btn.png')
                    }
                    style={styles.playBtnBg}
                    resizeMode="stretch">
                    <View style={styles.playBtnTextWrap}>
                      <Text style={[styles.btnText, styles.btnTextPlay]}>PLAY</Text>
                    </View>
                  </ImageBackground>
                </View>
              </Pressable>
            </Link>
          </View>
          <View
            style={[styles.btnWrapper, styles.otherBtnWrapper]}
            {...({
              onMouseEnter: () => setHoveredBtn('private'),
              onMouseLeave: () => setHoveredBtn(null),
            } as any)}>
            <Pressable
              style={({ pressed }) => [
                styles.btn,
                hoveredBtn === 'private' && styles.btnHover,
                pressed && styles.btnPressed,
              ]}>
              <View style={styles.btnInner}>
                <Text style={styles.btnText}>PRIVATE ROOM</Text>
              </View>
            </Pressable>
          </View>
          <View
            style={[styles.btnWrapper, styles.otherBtnWrapper]}
            {...({
              onMouseEnter: () => setHoveredBtn('leaderboard'),
              onMouseLeave: () => setHoveredBtn(null),
            } as any)}>
            <Pressable
              style={({ pressed }) => [
                styles.btn,
                hoveredBtn === 'leaderboard' && styles.btnHover,
                pressed && styles.btnPressed,
              ]}>
              <View style={styles.btnInner}>
                <Text style={styles.btnText}>LEADERBOARD</Text>
              </View>
            </Pressable>
          </View>
        </View>
      </View>

      {/* Settings button — bottom right (last so it draws on top) */}
      <Pressable
        style={({ pressed }) => [
          styles.settingsBtn,
          { right: 16, bottom: insets.bottom },
          pressed && styles.settingsBtnPressed,
        ]}
        onPress={() => router.push('/(tabs)/settings')}>
        <ImageBackground
          source={require('@/assets/images/settings-btn.png')}
          style={styles.settingsBtnImage}
          resizeMode="cover"
        />
      </Pressable>
    </View>
  );
}

const gold = '#FFD700';
const darkGold = '#B8860B';
const neonCyan = '#00FFFF';
const neonPink = '#FF10F0';
const btnBg = '#512E7B';
const btnBorderGlowTop = '#e879f9';
const btnBorderGlowBottom = neonCyan;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  neonBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 4,
    backgroundColor: neonCyan,
    opacity: 0.95,
    ...Platform.select({
      ios: {
        shadowColor: neonCyan,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.9,
        shadowRadius: 10,
      },
      android: {
        elevation: 12,
        shadowColor: neonCyan,
      },
      default: {},
    }),
  },
  content: {
    flex: 1,
    paddingHorizontal: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttons: {
    width: '100%',
    maxWidth: 320,
    gap: 16,
    alignItems: 'center',
    marginTop: 180,
    marginBottom: 32,
    paddingTop: 8,
  },
  btnWrapper: {
    width: '100%',
  },
  playBtnWrapper: {
    width: '100%',
    minHeight: 104,
    marginTop: 12,
    marginBottom: -8,
  },
  otherBtnWrapper: {
    width: '100%',
    maxWidth: 260,
    alignSelf: 'center',
  },
  btn: {
    width: '100%',
    minHeight: 56,
    backgroundColor: btnBg,
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderRadius: 28,
    borderWidth: 2,
    borderTopColor: btnBorderGlowTop,
    borderBottomColor: btnBorderGlowBottom,
    borderLeftColor: neonCyan,
    borderRightColor: neonCyan,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: neonCyan,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1,
        shadowRadius: 16,
      },
      android: {
        elevation: 20,
        shadowColor: neonCyan,
      },
      default: {
        shadowColor: neonCyan,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.95,
        shadowRadius: 16,
      },
    }),
  },
  btnPlay: {
    minHeight: 88,
    borderRadius: 44,
    borderWidth: 2,
    backgroundColor: 'transparent',
    borderTopColor: gold,
    borderBottomColor: btnBorderGlowBottom,
    borderLeftColor: neonCyan,
    borderRightColor: neonCyan,
    ...Platform.select({
      ios: {
        shadowColor: neonCyan,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1,
        shadowRadius: 16,
      },
      android: {
        elevation: 20,
        shadowColor: neonCyan,
      },
      default: {
        shadowColor: neonCyan,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.95,
        shadowRadius: 16,
      },
    }),
  },
  btnHover: {
    opacity: 1,
    ...Platform.select({
      ios: {
        shadowOpacity: 1,
        shadowRadius: 20,
      },
      android: {
        elevation: 22,
      },
      web: {
        shadowColor: neonCyan,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1,
        shadowRadius: 24,
        transform: [{ scale: 1.03 }],
      },
      default: {
        shadowOpacity: 1,
        shadowRadius: 22,
        transform: [{ scale: 1.02 }],
      },
    }),
  },
  btnPressed: {
    opacity: 0.88,
  },
  playBtnWrap: {
    overflow: 'hidden',
  },
  playBtnClip: {
    flex: 1,
    width: '100%',
    minHeight: 88,
    borderRadius: 42,
    overflow: 'hidden',
  },
  playBtnBg: {
    width: '100%',
    height: '100%',
    minHeight: 88,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playBtnTextWrap: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnInner: {
    borderWidth: 2,
    borderTopColor: 'rgba(255, 215, 0, 0.75)',
    borderBottomColor: 'rgba(0, 255, 255, 0.6)',
    borderLeftColor: 'rgba(255, 215, 0, 0.45)',
    borderRightColor: 'rgba(255, 215, 0, 0.45)',
    borderRadius: 24,
    paddingVertical: 18,
    paddingHorizontal: 44,
    width: '100%',
    minHeight: 48,
    backgroundColor: btnBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: {
    fontFamily: 'PressStart2P_400Regular',
    fontSize: Platform.OS === 'web' ? 15 : 13,
    color: gold,
    letterSpacing: 1,
    textAlign: 'center',
    ...Platform.select({
      ios: {
        textShadowColor: neonPink,
        textShadowOffset: { width: 0, height: 0 },
        textShadowRadius: 6,
      },
      android: {
        textShadowColor: neonPink,
        textShadowOffset: { width: 0, height: 0 },
        textShadowRadius: 4,
      },
      default: {
        textShadowColor: darkGold,
        textShadowOffset: { width: 1, height: 1 },
        textShadowRadius: 0,
      },
    }),
  },
  btnTextPlay: {
    fontSize: Platform.OS === 'web' ? 17 : 15,
    letterSpacing: 2,
    textAlign: 'center',
    ...Platform.select({
      ios: {
        textShadowColor: gold,
        textShadowOffset: { width: 0, height: 0 },
        textShadowRadius: 10,
      },
      android: {
        textShadowColor: gold,
        textShadowOffset: { width: 0, height: 0 },
        textShadowRadius: 8,
      },
      default: {
        textShadowColor: gold,
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 6,
      },
    }),
  },
  settingsBtn: {
    position: 'absolute',
    zIndex: 20,
    width: 56,
    height: 56,
    borderRadius: 12,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0,
    ...Platform.select({
      ios: {
        shadowColor: 'transparent',
        shadowOpacity: 0,
        shadowRadius: 0,
      },
      android: { elevation: 0 },
      default: {},
    }),
  },
  settingsBtnImage: {
    width: 56,
    height: 56,
    borderRadius: 12,
  },
  settingsBtnPressed: { opacity: 0.75 },
});
