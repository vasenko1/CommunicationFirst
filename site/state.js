export const CALL_STATES = Object.freeze({
  IDLE: "idle",
  REQUESTING_MICROPHONE: "requesting_microphone",
  CONNECTING_SIGNALING: "connecting_signaling",
  CONNECTED: "connected",
  RECONNECTING: "reconnecting",
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
    pc: null,
    offerSent: false,
  };
}
