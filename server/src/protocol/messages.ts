import {
  makeEnvelope,
  type ChatMessageBroadcastPayload,
  type GameEmoteBroadcastPayload,
  type ProtocolErrorCode,
  type RoomJoinedPayload,
  type ServerProtocolMessage,
  type SessionRenewedPayload,
} from '../../../src/shared/protocol.ts';
import type { RoomSnapshot, SimEvent } from '../../../src/shared/types.ts';
import { makeErrorPayload } from './errors.ts';

export function makeSessionRenewedMsg(
  payload: SessionRenewedPayload,
  requestId?: string,
): ServerProtocolMessage {
  return makeEnvelope('session:renewed', payload, requestId);
}

export function makeRoomJoinedMsg(
  payload: RoomJoinedPayload,
  requestId?: string,
): ServerProtocolMessage {
  return makeEnvelope('room:joined', payload, requestId);
}

export function makeRoomStateMsg(snapshot: RoomSnapshot, requestId?: string): ServerProtocolMessage {
  return makeEnvelope('room:state', { snapshot }, requestId);
}

export function makeGameSnapshotMsg(snapshot: RoomSnapshot): ServerProtocolMessage {
  return makeEnvelope('game:snapshot', { snapshot });
}

export function makeGameEventMsg(events: SimEvent[]): ServerProtocolMessage {
  return makeEnvelope('game:event', { events });
}

export function makeChatMessageMsg(
  payload: ChatMessageBroadcastPayload,
  requestId?: string,
): ServerProtocolMessage {
  return makeEnvelope('chat:message', payload, requestId);
}

export function makeGameEmoteMsg(
  payload: GameEmoteBroadcastPayload,
  requestId?: string,
): ServerProtocolMessage {
  return makeEnvelope('game:emote', payload, requestId);
}

export function makeRoomErrorMsg(
  code: ProtocolErrorCode,
  message?: string,
  requestId?: string,
  command?: string,
): ServerProtocolMessage {
  return makeEnvelope('room:error', makeErrorPayload(code, message, command), requestId);
}

export function makePongMsg(
  serverTime: number,
  clientTime?: number,
  requestId?: string,
): ServerProtocolMessage {
  return makeEnvelope('pong', { serverTime, clientTime }, requestId);
}
