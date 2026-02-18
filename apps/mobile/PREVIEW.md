# How to Run & Preview GoldenFlop

Your app uses **expo-dev-client** and Solana Mobile Wallet Adapter, so you need a **development build** on your device. **Expo Go will not work** for this project.

---

## Option A: Preview on your Android phone (no Android Studio)

### 1. Build the app (if you haven’t already)

From repo root or `apps/mobile`:

```bash
cd apps/mobile
npx eas build --profile development --platform android
```

- In EAS dashboard, wait for the build to finish.
- Download the **APK** and install it on your phone (internal distribution link or “Download” on the build page).

### 2. Start the dev server

On your computer (same machine that will serve the app):

```bash
cd apps/mobile
npm start
# or: npx expo start
```

- Leave this terminal running (Metro bundler).

### 3. Open the app on your phone

1. **Same Wi‑Fi:** Phone and computer must be on the same network.
2. Open the **GoldenFlop** app you installed (the dev build), not Expo Go.
3. It should connect to Metro and load your app. If it asks for a URL, shake the device or use the dev menu to enter your computer’s IP (e.g. `192.168.x.x:8081`).

**Troubleshooting:** If it doesn’t connect, run `expo start --tunnel` and use the tunnel URL in the dev client.

---

## Option B: Preview build (standalone APK, no Metro)

Good for sharing or testing without a dev server:

```bash
cd apps/mobile
npx eas build --profile preview --platform android
```

- Install the APK from the EAS link. This build runs without `expo start`; open the app and use it like a normal app.

---

## Option C: Android Studio (optional, for emulator only)

You only need Android Studio if you want to use an **emulator**:

1. Install Android Studio and create an AVD (Android Virtual Device).
2. Build the **development** APK with EAS (same as Option A step 1).
3. Install that APK on the emulator (drag‑and‑drop or `adb install path/to.apk`).
4. Run `npm start` in `apps/mobile`, then open the GoldenFlop app in the emulator so it connects to Metro.

---

## Quick reference

| Goal                         | Command / Action |
|-----------------------------|-------------------|
| Build dev APK for phone     | `cd apps/mobile && npx eas build --profile development --platform android` |
| Run dev server              | `cd apps/mobile && npm start` |
| Build standalone preview APK| `cd apps/mobile && npx eas build --profile preview --platform android` |
| Use Expo Go?                | No – use the custom dev build or preview APK. |

**Summary:** You do **not** need Android Studio to check the app on your Android phone. Install the development (or preview) APK from EAS, then for daily dev run `npm start` in `apps/mobile` and open the GoldenFlop app on your phone.
