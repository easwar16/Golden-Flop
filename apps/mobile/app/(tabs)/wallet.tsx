import { useWallet } from '@/contexts/wallet-context';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { StyleSheet, Alert, Platform, ImageBackground, View } from 'react-native';
import { Pressable } from 'react-native';

function ConnectWalletButton() {
  const { authorize, isLoading, accounts } = useWallet();
  return (
    <Pressable
      onPress={authorize}
      disabled={isLoading}
      style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}>
      <ThemedText style={styles.buttonText}>
        {isLoading ? 'Connecting…' : accounts?.length ? 'Connected' : 'Connect Wallet'}
      </ThemedText>
    </Pressable>
  );
}

function SignMessageButton() {
  const { signMessage, accounts, isLoading } = useWallet();
  const handleSign = async () => {
    if (!accounts?.length) {
      Alert.alert('Not connected', 'Connect a wallet first.');
      return;
    }
    try {
      const message = new TextEncoder().encode('GoldenFlop poker – sign to verify.');
      const signed = await signMessage(message);
      Alert.alert('Signed', `Message signed (${signed.length} bytes).`);
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <Pressable
      onPress={handleSign}
      disabled={isLoading || !accounts?.length}
      style={({ pressed }) => [styles.button, styles.buttonSecondary, pressed && styles.buttonPressed]}>
      <ThemedText style={styles.buttonText}>Sign message</ThemedText>
    </Pressable>
  );
}

export default function WalletScreen() {
  const { accounts, error } = useWallet();
  const address = accounts?.[0]?.address;
  const shortAddress =
    address && typeof address === 'object' && address.length != null
      ? `${Array.from(address as Uint8Array).slice(0, 4).join(',')}…`
      : address
        ? String(address).slice(0, 12) + '…'
        : null;

  return (
    <View style={styles.root}>
      <ImageBackground
        source={require('@/assets/images/casino-bg.png')}
        style={StyleSheet.absoluteFill}
        resizeMode="cover"
      />
      <ThemedView style={styles.container}>
        <ThemedText type="title" style={styles.title}>
          Wallet
        </ThemedText>
        <ThemedText style={styles.subtitle}>
          Connect via Mobile Wallet Adapter (MWA). Use a custom dev build on Android.
        </ThemedText>
        {error ? (
          <ThemedText style={styles.error}>{error}</ThemedText>
        ) : null}
        {shortAddress ? (
          <ThemedText style={styles.address}>Account: {shortAddress}</ThemedText>
        ) : null}
        <ConnectWalletButton />
        <SignMessageButton />
      </ThemedView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  container: {
    flex: 1,
    padding: 24,
    gap: 16,
    backgroundColor: 'transparent',
  },
  title: {
    marginBottom: 8,
  },
  subtitle: {
    opacity: 0.8,
    marginBottom: 8,
  },
  error: {
    color: 'red',
  },
  address: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  button: {
    backgroundColor: '#0a7ea4',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonSecondary: {
    backgroundColor: '#333',
  },
  buttonPressed: {
    opacity: 0.8,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
});
