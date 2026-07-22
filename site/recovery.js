export const RECOVERY_STATES = Object.freeze({
  CONNECTED: "CONNECTED",
  DISCONNECTED: "DISCONNECTED",
  AWAITING_TRANSPORT: "AWAITING_TRANSPORT",
  AWAITING_PEER_RECOVERY: "AWAITING_PEER_RECOVERY",
  VERIFIED_CONNECTED: "VERIFIED_CONNECTED",
});

export const RECOVERY_ACTIONS = Object.freeze({
  NONE: "none",
  START_ICE_RESTART: "start-ice-restart",
  GIVE_UP: "give-up",
});

export const RECOVERY_EVENTS = Object.freeze({
  PEER_CONNECTED: "PEER_CONNECTED",
  PEER_DISCONNECTED: "PEER_DISCONNECTED",
  PEER_FAILED: "PEER_FAILED",
  TRANSPORT_CONNECTED: "TRANSPORT_CONNECTED",
  TRANSPORT_RECONNECTING: "TRANSPORT_RECONNECTING",
  TRANSPORT_FAILED: "TRANSPORT_FAILED",
  DISCONNECT_DEBOUNCE_EXPIRED: "DISCONNECT_DEBOUNCE_EXPIRED",
  CONNECTION_VERIFIED: "CONNECTION_VERIFIED",
});

export class RecoveryController {
  constructor() {
    this.reset();
  }

  shouldRestartIce() {
    return this.state === RECOVERY_STATES.AWAITING_PEER_RECOVERY;
  }

  reset() {
    this.state = RECOVERY_STATES.CONNECTED;
  }

  enterDisconnected() {
    this.state = RECOVERY_STATES.DISCONNECTED;
    return RECOVERY_ACTIONS.NONE;
  }

  startIceRestart() {
    this.state = RECOVERY_STATES.AWAITING_PEER_RECOVERY;
    return RECOVERY_ACTIONS.START_ICE_RESTART;
  }

  awaitTransport() {
    this.state = RECOVERY_STATES.AWAITING_TRANSPORT;
    return RECOVERY_ACTIONS.NONE;
  }

  enterVerifiedConnected() {
    this.state = RECOVERY_STATES.VERIFIED_CONNECTED;
    return RECOVERY_ACTIONS.NONE;
  }

  enterConnected() {
    this.state = RECOVERY_STATES.CONNECTED;
    return RECOVERY_ACTIONS.NONE;
  }

  handle(event) {
    switch (this.state) {
      case RECOVERY_STATES.CONNECTED:
        switch (event?.type) {
          case RECOVERY_EVENTS.PEER_DISCONNECTED:
            return this.enterDisconnected();

          case RECOVERY_EVENTS.PEER_FAILED:
            return this.startIceRestart();

          case RECOVERY_EVENTS.TRANSPORT_RECONNECTING:
          case RECOVERY_EVENTS.TRANSPORT_FAILED:
            return this.awaitTransport();

          default:
            return RECOVERY_ACTIONS.NONE;
        }

      case RECOVERY_STATES.DISCONNECTED:
        switch (event?.type) {
          case RECOVERY_EVENTS.PEER_CONNECTED:
            return this.enterConnected();

          case RECOVERY_EVENTS.PEER_FAILED:
          case RECOVERY_EVENTS.DISCONNECT_DEBOUNCE_EXPIRED:
            return this.startIceRestart();

          case RECOVERY_EVENTS.TRANSPORT_RECONNECTING:
          case RECOVERY_EVENTS.TRANSPORT_FAILED:
            return this.awaitTransport();

          default:
            return RECOVERY_ACTIONS.NONE;
        }

      case RECOVERY_STATES.AWAITING_TRANSPORT:
        switch (event?.type) {
          case RECOVERY_EVENTS.TRANSPORT_CONNECTED:
            return this.startIceRestart();

          case RECOVERY_EVENTS.PEER_CONNECTED:
            return this.enterConnected();

          default:
            return RECOVERY_ACTIONS.NONE;
        }

      case RECOVERY_STATES.AWAITING_PEER_RECOVERY:
        switch (event?.type) {
          case RECOVERY_EVENTS.PEER_CONNECTED:
            return this.enterVerifiedConnected();

          case RECOVERY_EVENTS.PEER_DISCONNECTED:
            return this.enterDisconnected();

          case RECOVERY_EVENTS.TRANSPORT_RECONNECTING:
          case RECOVERY_EVENTS.TRANSPORT_FAILED:
            return this.awaitTransport();

          default:
            return RECOVERY_ACTIONS.NONE;
        }

      case RECOVERY_STATES.VERIFIED_CONNECTED:
        switch (event?.type) {
          case RECOVERY_EVENTS.CONNECTION_VERIFIED:
              return this.enterConnected();

          case RECOVERY_EVENTS.PEER_DISCONNECTED:
            return this.enterDisconnected();

          case RECOVERY_EVENTS.TRANSPORT_RECONNECTING:
          case RECOVERY_EVENTS.TRANSPORT_FAILED:
            return this.awaitTransport();

          default:
            return RECOVERY_ACTIONS.NONE;
        }

      default:
        return RECOVERY_ACTIONS.NONE;
    }
  }
}
