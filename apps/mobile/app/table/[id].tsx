import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ActionBar } from '@/components/poker/action-bar';
import { ChipStack } from '@/components/poker/chip-stack';
import { PokerCard } from '@/components/poker/poker-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { formatPlayerId } from '@/constants/seeker';
import { useGame } from '@/contexts/game-context';
import { useWallet } from '@/contexts/wallet-context';
import { useAllInHammer } from '@/hooks/use-all-in-hammer';
import { usePokerHaptics } from '@/hooks/use-poker-haptics';
import { useTactilePeek } from '@/hooks/use-tactile-peek';

export default function TableScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { game, currentTable, leaveTable, peekHoleCard, stopPeek, performAction } = useGame();
  const { accounts } = useWallet();
  const haptics = usePokerHaptics();
  const { requestPeek, releasePeek } = useTactilePeek();

  const handleAllIn = () => {
    haptics.allIn();
    performAction('all-in');
  };
  const { handleTap: hammerTap } = useAllInHammer(handleAllIn);

  useEffect(() => {
    if (game?.isYourTurn) {
      haptics.yourTurn();
    }
  }, [game?.isYourTurn]);

  useEffect(() => {
    if (game?.phase === 'preflop' && game?.isYourTurn) {
      haptics.bigBlindApproaching();
    }
  }, [game?.phase, game?.isYourTurn, haptics]);

  if (!game || !currentTable || game.tableId !== id) {
    return (
      <ThemedView style={styles.container}>
        <ThemedText>Loading table…</ThemedText>
      </ThemedView>
    );
  }

  const handleAction = (action: 'fold' | 'call' | 'raise' | 'all-in', amount?: number) => {
    if (action === 'all-in') haptics.allIn();
    performAction(action, amount);
  };

  const rawAddress = accounts?.[0]?.address;
  const playerLabel =
    rawAddress == null
      ? formatPlayerId(undefined)
      : typeof rawAddress === 'string'
        ? formatPlayerId(rawAddress)
        : formatPlayerId(undefined);

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <View>
          <ThemedText style={styles.blinds}>
            {currentTable.smallBlind}/{currentTable.bigBlind}
          </ThemedText>
          <ThemedText style={styles.seekerId}>{playerLabel}</ThemedText>
        </View>
        <Pressable onPress={() => { leaveTable(); router.back(); }} style={styles.leaveBtn}>
          <ThemedText style={styles.leaveText}>Leave</ThemedText>
        </Pressable>
      </View>

      <View style={styles.communityArea}>
        <ThemedText style={styles.sectionLabel}>Community</ThemedText>
        <View style={styles.communityCards}>
          {game.communityCards.map((c, i) => (
            <PokerCard key={i} card={c} />
          ))}
        </View>
      </View>

      <ChipStack amount={game.pot} label="Pot" />

      <View style={styles.holeCardArea}>
        <ThemedText style={styles.sectionLabel}>
          Your cards (hold to peek — Seeker: thumb on sensor)
        </ThemedText>
        <View style={styles.holeCards}>
          <Pressable
            onPressIn={() => requestPeek(0)}
            onPressOut={releasePeek}
            style={styles.holeCardWrap}>
            <PokerCard
              card={game.holeCards[0]}
              faceDown={!game.holeCardsRevealed[0]}
              onPressIn={() => requestPeek(0)}
              onPressOut={releasePeek}
            />
          </Pressable>
          <Pressable
            onPressIn={() => requestPeek(1)}
            onPressOut={releasePeek}
            style={styles.holeCardWrap}>
            <PokerCard
              card={game.holeCards[1]}
              faceDown={!game.holeCardsRevealed[1]}
              onPressIn={() => requestPeek(1)}
              onPressOut={releasePeek}
            />
          </Pressable>
        </View>
      </View>

      <Pressable onPress={hammerTap} style={styles.hammerZone}>
        <ThemedText style={styles.hammerText}>Double-tap: All-In (Seeker: side button)</ThemedText>
      </Pressable>

      <View style={styles.yourChips}>
        <ChipStack amount={game.yourChips} label="Your stack" />
      </View>

      <ActionBar
        callAmount={game.currentBet}
        minRaise={currentTable.bigBlind}
        isYourTurn={game.isYourTurn}
        onAction={handleAction}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    paddingBottom: 0,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  blinds: {
    fontWeight: '700',
    fontSize: 18,
  },
  leaveBtn: {
    padding: 8,
    backgroundColor: '#555',
    borderRadius: 8,
  },
  leaveText: {
    color: '#fff',
    fontSize: 14,
  },
  seekerId: {
    fontSize: 12,
    opacity: 0.7,
    marginTop: 2,
  },
  communityArea: {
    marginBottom: 16,
  },
  sectionLabel: {
    fontSize: 12,
    opacity: 0.8,
    marginBottom: 8,
  },
  communityCards: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  holeCardArea: {
    marginBottom: 16,
  },
  holeCards: {
    flexDirection: 'row',
    gap: 12,
  },
  holeCardWrap: {
    alignSelf: 'flex-start',
  },
  yourChips: {
    marginBottom: 16,
  },
  hammerZone: {
    padding: 12,
    marginBottom: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#c62828',
    borderStyle: 'dashed',
    alignItems: 'center',
  },
  hammerText: {
    fontSize: 12,
    opacity: 0.9,
  },
});
