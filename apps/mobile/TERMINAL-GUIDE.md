# What You See in the Terminal (npm run web)

When you run **`npm run web`** (or `expo start --web`), here’s what each part means.

---

## 1. **The big block of characters (▄▄▄ and █)**

That’s a **QR code** in text form.

- **Use it on a real device:** Open the **Expo Go** app (or your **development build** app) on your phone, choose “Scan QR code,” and point it at this QR in the terminal (or at the same QR in the browser).
- **On your computer:** You usually **don’t** need it when using the web; you use the URL below instead.

---

## 2. **The URLs**

- **`exp+goldenflop://expo-development-client/?url=...`**  
  Deep link for opening this project in the **Expo development build** app on a device (not for the browser).

- **`http://localhost:8081`**  
  **This is your app in the browser.**  
  Open this in Chrome/Safari/Firefox to see the app when you run the web version.

---

## 3. **“Press w / a / i / s / r / m / j / ?”**

These are **keyboard shortcuts** while the dev server is running:

| Key   | Action                          |
|-------|----------------------------------|
| **w** | Open **web** (browser)           |
| **a** | Open **Android** emulator/device|
| **i** | Open **iOS** simulator          |
| **s** | **Switch** to Expo Go           |
| **r** | **Reload** the app              |
| **m** | Toggle **menu**                 |
| **j** | Open **debugger**               |
| **?** | **Show all** commands           |

So “what are this in the terminal” = **shortcuts you can press** to control where the app opens and to reload/debug.

---

## 4. **WARN about @noble/hashes/crypto.js**

A **warning** from a dependency (Solana/crypto). It’s not critical; the bundler falls back and the app can still run. You can ignore it unless something breaks.

---

## 5. **“TypeError: URL.canParse is not a function”**

This comes from **Metro** (the bundler), not from your app code. It usually means the **Node.js version** on your machine is too old: `URL.canParse` exists in **Node 18.17+** and in Node 20+.

**Fix:** Use a newer Node version, e.g. **Node 20 LTS** or **Node 22**.

- Check: `node -v`
- If it’s below 18.17 (e.g. 18.0), install Node 20 from [nodejs.org](https://nodejs.org) or with `nvm`:
  - `nvm install 20`
  - `nvm use 20`
- Then run `npm run web` again.

---

**Summary:** The terminal shows the **QR code** (for phone), the **web URL** (`http://localhost:8081`), and **keyboard shortcuts**. The **URL.canParse** error is fixed by upgrading Node.
