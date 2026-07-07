import { useRef, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { GestureResponderEvent } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { AnimatePresence, MotiView } from 'moti';
import type { Card } from '@trap/shared';
import { gameStore } from '../../src/state/game';
import { colors } from '../../src/lib/theme';
import { Button, LinkButton } from '../../src/ui/Button';
import { useLobbyScreen } from '../../src/ui/useLobbyScreen';
import { PlayingCard } from '../../src/ui/PlayingCard';
import { HistoryTimeline } from '../../src/ui/HistoryTimeline';
import { IncomingReveal } from '../../src/ui/IncomingReveal';
import { DURATION, useReducedMotion } from '../../src/ui/motion';
import { Celebration } from '../../src/ui/Celebration';
import { Screen } from '../../src/ui/Screen';
import { RefreshButton } from '../../src/ui/RefreshButton';
import { useRefresh } from '../../src/ui/useRefresh';

export default function GameScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const { userId, gameState } = useLobbyScreen('game', code);
  const { refreshing, onRefresh } = useRefresh();

  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);

  // Travel-animation state: where the hand card was tapped (page coords) and
  // the in-flight proxy's overlay-local start/end points.
  const selectPoint = useRef<{ x: number; y: number } | null>(null);
  const overlayRef = useRef<View>(null);
  const [flight, setFlight] = useState<{
    id: string;
    from: { x: number; y: number };
    to: { x: number; y: number };
  } | null>(null);
  const reduce = useReducedMotion();

  if (!userId) return <Redirect href="/login" />;

  if (!gameState) {
    return (
      <View style={styles.centered}>
        <Text style={styles.subtle}>Loading game…</Text>
      </View>
    );
  }

  const opponents = gameState.players.filter((p) => p.id !== userId);
  const myCards = gameState.myCards;
  const lastPlay = gameState.gameHistory[gameState.gameHistory.length - 1];

  // Derive the end-of-game view from durable state (status + winnerId), not the
  // transient `game_ended` message — so a re-entrant who reconnects after the
  // game ended still sees the result.
  const concluded = gameState.status === 'concluded';
  const winnerId = gameState.winnerId;
  const winnerUsername = gameState.winnerUsername;
  const iWon = concluded && winnerId === userId;

  const playOn = (targetPlayerId: string, e?: GestureResponderEvent) => {
    if (concluded || !selectedCardId) return;
    const start = selectPoint.current;
    const end = e ? { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY } : null;
    if (start && end && !reduce) {
      // Convert page coords to overlay-local coords, then fly.
      overlayRef.current?.measureInWindow((ox, oy) => {
        setFlight({
          id: `${selectedCardId}-${Date.now()}`,
          from: { x: start.x - ox, y: start.y - oy },
          to: { x: end.x - ox, y: end.y - oy },
        });
      });
    }
    selectPoint.current = null;
    gameStore.getState().playCard(selectedCardId, targetPlayerId);
    setSelectedCardId(null);
  };

  const leave = () => {
    gameStore.getState().exit();
    router.replace('/');
  };

  return (
    <Screen style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.muted}
            colors={[colors.muted]}
          />
        }
      >
        <RefreshButton refreshing={refreshing} onRefresh={onRefresh} />
        <Text style={styles.section}>Opponents</Text>
        <Text style={styles.hint}>
          {selectedCardId
            ? 'Tap an opponent to play your selected card.'
            : 'Select a card from your hand first.'}
        </Text>
        {opponents.map((p) => (
          <MotiView
            key={`${p.id}-${lastPlay?.targetId === p.id ? lastPlay.id : 'idle'}`}
            from={{ scale: lastPlay?.targetId === p.id ? 1.08 : 1 }}
            animate={{ scale: 1 }}
            transition={{ type: 'timing', duration: 260 }}
          >
            <Pressable
              testID="opponent"
              style={[
                styles.opponent,
                selectedCardId && !concluded ? styles.opponentArmed : styles.opponentIdle,
              ]}
              onPress={(e) => playOn(p.id, e)}
              disabled={!selectedCardId || concluded}
            >
              <View style={styles.opponentInfo}>
                <Text style={styles.opponentName}>{p.username}</Text>
                <Text style={styles.subtle}>{p.cardsRemaining} cards</Text>
              </View>
              <Text
                style={[styles.opponentAction, !selectedCardId && styles.opponentActionIdle]}
              >
                {selectedCardId ? 'Play here ▸' : 'Select a card first'}
              </Text>
            </Pressable>
          </MotiView>
        ))}

        <Text style={styles.section}>Your hand</Text>
        <View style={styles.hand}>
          <AnimatePresence>
            {myCards.map((card: Card, i: number) => (
              <PlayingCard
                key={card.id}
                statement={card.statement}
                index={i}
                selected={card.id === selectedCardId}
                onPress={(e) => {
                  selectPoint.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
                  setSelectedCardId(card.id === selectedCardId ? null : card.id);
                }}
              />
            ))}
          </AnimatePresence>
          {myCards.length === 0 ? (
            <Text style={styles.subtle}>No cards left.</Text>
          ) : null}
        </View>

        <Text style={styles.section}>History</Text>
        <HistoryTimeline items={gameState.gameHistory} myPlayerId={userId} />
      </ScrollView>

      <IncomingReveal lobbyCode={code} playerId={userId} gameState={gameState} />

      {concluded ? (
        <>
          <Celebration />
          <MotiView
            style={styles.endedBanner}
            from={{ opacity: 0, translateY: 24 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 320 }}
          >
            <Text style={styles.endedText}>
              {iWon
                ? '🏆 You sprung all your traps first!'
                : `🏆 ${winnerUsername ?? 'Someone'} sprung all their traps first`}
            </Text>
            <Button title="Back to home" onPress={leave} />
          </MotiView>
        </>
      ) : (
        <LinkButton title="Return to lobby" style={styles.returnLink} onPress={leave} />
      )}

      <View
        ref={overlayRef}
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
        collapsable={false}
      >
        {flight ? (
          <MotiView
            key={flight.id}
            style={styles.flightCard}
            from={{
              translateX: flight.from.x - 17,
              translateY: flight.from.y - 24,
              scale: 1,
              opacity: 1,
              rotate: '0deg',
            }}
            animate={{
              translateX: flight.to.x - 17,
              translateY: flight.to.y - 24,
              scale: 0.55,
              opacity: 0,
              rotate: '10deg',
            }}
            transition={{ type: 'timing', duration: DURATION.base * 1.5 }}
            onDidAnimate={(key) => {
              if (key === 'opacity') setFlight(null);
            }}
          />
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  // Screen already clears the transparent header (useHeaderHeight), so this
  // is plain content inset like the other scrolled screens.
  scroll: { paddingTop: 20, paddingHorizontal: 20, paddingBottom: 20, gap: 8 },
  section: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    marginTop: 16,
  },
  hint: { color: colors.muted, fontSize: 13 },
  opponent: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: 14,
    marginTop: 8,
    borderWidth: 2,
    borderColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  // Dimmed + neutral border until a card is selected.
  opponentIdle: { borderColor: colors.border, opacity: 0.55 },
  // Lit up as a tap target once a card is armed (matches the green selected card).
  opponentArmed: { borderColor: colors.accent },
  opponentInfo: { flexShrink: 1 },
  opponentAction: { color: colors.accent, fontSize: 15, fontWeight: '700' },
  opponentActionIdle: { color: colors.muted, fontSize: 13, fontWeight: '400' },
  opponentName: { color: colors.text, fontSize: 16, fontWeight: '600' },
  hand: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 },
  subtle: { color: colors.muted, fontSize: 14 },
  endedBanner: {
    backgroundColor: colors.surface,
    padding: 20,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  endedText: { color: colors.text, fontSize: 20, fontWeight: '700' },
  returnLink: { paddingVertical: 14 },
  flightCard: {
    position: 'absolute',
    width: 34,
    height: 48,
    borderRadius: 6,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.primary,
  },
});
