export class SignalingClient extends EventTarget {
  constructor(baseUrl) {
    super();
    this.baseUrl = baseUrl;
    this.ws = null;
    this.opened = false;
    this.roomId = null;
    this.peerId = null;
  }

  connect(roomId, peerId) {
    this.roomId = roomId;
    this.peerId = peerId;

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(
        `${this.baseUrl}/room/${roomId}?peer=${peerId}`
      );

      this.ws = ws;

      ws.onopen = () => {
        this.opened = true;
        this.dispatchEvent(new Event("open"));
        resolve();
      };

      ws.onmessage = (event) => {
        this.dispatchEvent(
          new CustomEvent("message", { detail: event.data })
        );
      };

      ws.onerror = (event) => {
        this.dispatchEvent(
          new CustomEvent("error", { detail: event })
        );
        if (!this.opened) {
          reject(new Error("WebSocket failed to open"));
        }
      };

      ws.onclose = (event) => {
        this.dispatchEvent(
          new CustomEvent("close", {
            detail: { code: event.code, reason: event.reason }
          })
        );
        if (!this.opened) {
          reject(new Error("WebSocket closed before open"));
        }
      };
    });
  }

  send(payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(payload));
  }

  close() {
    if (!this.ws) return;
    try {
      this.ws.close();
    } catch {}
  }
}
