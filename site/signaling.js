// SignalingSession — transport layer only (see docs/CLIENT_ARCHITECTURE.md).
//
// Owns the WebSocket lifecycle and NOTHING else: it knows nothing about SDP,
// ICE, offer/answer, or the meaning of "join". Payloads are opaque.
//
// Responsibilities:
//   - connect / reconnect the socket to the same room + peer
//   - exponential backoff, bounded attempts, "failed" when exhausted
//   - report WHICH transition happened: connected {reconnect: boolean}
//
// Backward compatibility: the current app.js still uses connect() + the legacy
// "open"/"close"/"error"/"message" events and the SignalingClient name. Those
// are preserved so this file can be swapped in without touching app.js. The new
// events ("connected", "statechange", "failed") are additive; app.js will move
// onto them in a later step.

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 8000;
const RECONNECT_MAX_ATTEMPTS = 10;
const STABLE_CONNECTION_MS = 8000;

export class SignalingSession extends EventTarget {
  constructor(baseUrl) {
    super();
    this.baseUrl = baseUrl;
    this.ws = null;
    this.state = "disconnected";
    this.roomId = null;
    this.peerId = null;

    this.intentionalClose = false;
    this.openedOnce = false;

    this.connectResolve = null;
    this.connectReject = null;

    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.stableTimer = null;
  }

  start(roomId, peerId) {
    return this.connect(roomId, peerId);
  }

  connect(roomId, peerId) {
    this.roomId = roomId;
    this.peerId = peerId;
    this.intentionalClose = false;
    this.openedOnce = false;
    this.reconnectAttempts = 0;
    this._clearReconnectTimer();
    this._clearStableTimer();

    this._detachAndClose(this.ws);
    this.ws = null;

    const promise = new Promise((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;
    });

    this._openSocket();
    return promise;
  }

  send(payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(payload));
  }

  stop() {
    this.intentionalClose = true;
    this._clearReconnectTimer();
    this._clearStableTimer();
    this._setState("disconnected");

    const ws = this.ws;
    this.ws = null;
    this._detachAndClose(ws);
    this._rejectPending(new Error("Signaling stopped"));
  }

  close() {
    this.stop();
  }

  _openSocket() {
    this._setState(this.openedOnce ? "reconnecting" : "connecting");

    let ws;
    try {
      ws = new WebSocket(
        `${this.baseUrl}/room/${this.roomId}?peer=${this.peerId}`
      );
    } catch (err) {
      if (this.openedOnce) {
        this._scheduleReconnect();
      } else {
        this._setState("disconnected");
        this._rejectPending(
          err instanceof Error
            ? err
            : new Error("WebSocket construction failed")
        );
      }
      return;
    }

    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      const reconnect = this.openedOnce;
      this.openedOnce = true;
      this._setState("connected");

      this.dispatchEvent(new CustomEvent("connected", {
        detail: { reconnect }
      }));
      this.dispatchEvent(new Event("open"));

      if (this.connectResolve) {
        const resolve = this.connectResolve;
        this.connectResolve = null;
        this.connectReject = null;
        resolve();
      }

      this._clearStableTimer();
      this.stableTimer = setTimeout(() => {
        this.stableTimer = null;
        this.reconnectAttempts = 0;
      }, STABLE_CONNECTION_MS);
    };

    ws.onmessage = (event) => {
      if (this.ws !== ws) return;
      this.dispatchEvent(new CustomEvent("message", { detail: event.data }));
    };

    ws.onerror = (event) => {
      if (this.ws !== ws) return;
      this.dispatchEvent(new CustomEvent("error", { detail: event }));
    };

    ws.onclose = (event) => {
      if (this.ws !== ws) return;
      this._clearStableTimer();
      this.dispatchEvent(new CustomEvent("close", {
        detail: { code: event.code, reason: event.reason }
      }));

      if (this.intentionalClose) {
        this._setState("disconnected");
        this._rejectPending(new Error("WebSocket closed"));
        return;
      }

      if (!this.openedOnce) {
        this._setState("disconnected");
        this.dispatchEvent(new Event("error"));
        this._rejectPending(new Error("WebSocket closed before open"));
        return;
      }

      this._scheduleReconnect();
    };
  }

  _scheduleReconnect() {
    if (this.reconnectTimer) return;

    if (this.reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
      this._setState("disconnected");
      this.dispatchEvent(new Event("failed"));
      this.dispatchEvent(new Event("error"));
      return;
    }

    this._setState("reconnecting");
    const delay = Math.min(
      RECONNECT_MAX_MS,
      RECONNECT_BASE_MS * 2 ** this.reconnectAttempts
    );
    this.reconnectAttempts += 1;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.intentionalClose) return;
      this._openSocket();
    }, delay);
  }

  _setState(next) {
    if (this.state === next) return;
    this.state = next;
    this.dispatchEvent(new CustomEvent("statechange", {
      detail: { state: next }
    }));
  }

  _rejectPending(error) {
    if (!this.connectReject) return;
    const reject = this.connectReject;
    this.connectResolve = null;
    this.connectReject = null;
    reject(error);
  }

  _detachAndClose(ws) {
    if (!ws) return;
    ws.onopen = null;
    ws.onmessage = null;
    ws.onerror = null;
    ws.onclose = null;
    try {
      ws.close();
    } catch {}
  }

  _clearReconnectTimer() {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  _clearStableTimer() {
    if (!this.stableTimer) return;
    clearTimeout(this.stableTimer);
    this.stableTimer = null;
  }
}

export class SignalingClient extends SignalingSession {}
