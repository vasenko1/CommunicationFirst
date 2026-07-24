export const END_REASONS = Object.freeze({
  USER: "user",
  PEER: "peer",
  NETWORK: "network",
  ERROR: "error",
});

export function createInitialState() {
  return {
    active: false,
    host: false,
    roomId: null,
    peerId: null,
  };
}
