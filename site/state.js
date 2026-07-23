export const CALL_STATES = Object.freeze({
  IDLE: "idle",
  REQUESTING_MICROPHONE: "requesting_microphone",
  CONNECTING_SIGNALING: "connecting_signaling",
  NEGOTIATING: "negotiating",
  CONNECTED: "connected",
  RECONNECTING: "reconnecting",
  ENDED: "ended",
});

export const END_REASONS = Object.freeze({
  USER: "user",
  PEER: "peer",
  NETWORK: "network",
  ERROR: "error",
  UNKNOWN: "unknown",
});

export function createInitialState() {
  return {
    callState: CALL_STATES.IDLE,
    active: false,
    host: false,
    roomId: null,
    peerId: null,
    ws: null,
    pc: null,
    localStream: null,
    offerSent: false,
    peerJoined: false,
    endReason: END_REASONS.UNKNOWN,
  };
}
