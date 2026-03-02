/**
 * InviteModal — intermediary modal shown when tapping an empty seat.
 *
 * Options:
 *  - Invite Friend: generates invite link + opens native share sheet
 *  - Sit Down: closes this modal and triggers BuyInModal
 *  - Cancel: dismisses modal
 */

import React, { memo, useCallback, useState } from 'react';
import {
  Modal,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { useAuth } from '@/contexts/auth-context';
import { generateInvite } from '@/services/InviteService';

const gold = '#FFD700';
const cyan = '#00FFFF';

interface InviteModalProps {
  visible: boolean;
  seatIndex: number;
  tableId: string;
  /** Show the "Sit Down" option (false when player is already seated) */
  showSitDown?: boolean;
  onClose: () => void;
  onSitDown: (seatIndex: number) => void;
}

export const InviteModal = memo(function InviteModal({
  visible,
  seatIndex,
  tableId,
  showSitDown = true,
  onClose,
  onSitDown,
}: InviteModalProps) {
  const { token, isAuthenticated } = useAuth();
  const [sending, setSending] = useState(false);

  const handleInvite = useCallback(async () => {
    if (!token) {
      // Fall through to share a generic message if not authenticated
      await Share.share({
        message: `Join me at the poker table on GoldenFlop! Download the app: https://goldenflop.app`,
      });
      return;
    }

    setSending(true);
    try {
      const result = await generateInvite(tableId, token);
      await Share.share({
        message: `Join my poker table on GoldenFlop!\n${result.httpsLink}`,
      });
    } catch (e) {
      console.error('[InviteModal] share error:', e);
    } finally {
      setSending(false);
    }
  }, [tableId, token]);

  const handleSitDown = useCallback(() => {
    onClose();
    onSitDown(seatIndex);
  }, [onClose, onSitDown, seatIndex]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={s.overlay}>
          <TouchableWithoutFeedback onPress={() => {}}>
            <View style={s.panel}>
              <Text style={s.title}>INVITE A FRIEND</Text>
              <Text style={s.sub}>Bring someone to this table.</Text>

              {/* Invite Friend button */}
              <Pressable
                style={({ pressed }) => [s.btn, s.inviteBtn, pressed && s.btnPressed, sending && { opacity: 0.5 }]}
                onPress={handleInvite}
                disabled={sending}>
                <Text style={s.inviteBtnText}>
                  {sending ? 'GENERATING...' : 'INVITE FRIEND'}
                </Text>
              </Pressable>

              {/* Sit Down button (hidden when player is already seated) */}
              {showSitDown && (
                <Pressable
                  style={({ pressed }) => [s.btn, s.sitBtn, pressed && s.btnPressed]}
                  onPress={handleSitDown}>
                  <Text style={s.sitBtnText}>SIT DOWN</Text>
                </Pressable>
              )}

              {/* Cancel */}
              <Pressable onPress={onClose} style={{ paddingVertical: 4 }}>
                <Text style={s.cancel}>Cancel</Text>
              </Pressable>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
});

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  panel: {
    backgroundColor: '#1A0A2E',
    borderWidth: 2,
    borderColor: cyan,
    borderRadius: 16,
    padding: 24,
    width: 280,
    alignItems: 'center',
    gap: 12,
    // Glow effect
    shadowColor: cyan,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 12,
  },
  title: {
    fontFamily: 'PressStart2P_400Regular',
    fontSize: 12,
    color: cyan,
    textAlign: 'center',
  },
  sub: {
    fontFamily: 'PressStart2P_400Regular',
    fontSize: 7,
    color: 'rgba(255,255,255,0.6)',
    textAlign: 'center',
    marginBottom: 4,
  },
  btn: {
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 24,
    width: '100%',
    alignItems: 'center',
  },
  btnPressed: { opacity: 0.85 },
  inviteBtn: {
    backgroundColor: '#512E7B',
    borderWidth: 2,
    borderColor: gold,
  },
  inviteBtnText: {
    fontFamily: 'PressStart2P_400Regular',
    fontSize: 10,
    color: gold,
  },
  sitBtn: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: cyan,
  },
  sitBtnText: {
    fontFamily: 'PressStart2P_400Regular',
    fontSize: 10,
    color: cyan,
  },
  cancel: {
    fontFamily: 'PressStart2P_400Regular',
    fontSize: 8,
    color: 'rgba(255,255,255,0.5)',
  },
});
