const SIGNALING_BASE = "wss://communication-first.communication-first-igor.workers.dev";

const App = {
  els: {},
  state: {
    active: false,
    host: false,
    roomId: null,
    peerId: null,
    ws: null,
    peerJoined: false,
  },

  init() {
    this.els.button = document.getElementById("startCallBtn");
    this.els.statusText = document.getElementById("statusText");
    this.els.statusDot = document.getElementById("statusDot");
    this.els.inviteBox = document.getElementById("inviteBox");
    this.els.inviteUrl = document.getElementById("inviteUrl");
    this.els.copyButton = document.getElementById("copyInviteBtn");

    this.els.button.addEventListener("click", () => this.onMainAction());
    this.els.copyButton.addEventListener("click", () => this.copyInviteLink());
    window.addEventListener("hashchange", () => this.syncIdleUI());
    window.addEventListener("beforeunload", () => this.endCall(false));

    this.syncIdleUI();
    this.setStatus("Ready", "🟢");
    this.showInvite(false);
  },

  syncIdleUI() {
    if (this.state.active) {
      this.els.button.textContent = "End Call";
      return;
    }

    this.els.button.disabled = false;
    this.els.button.textContent = this.roomIdFromHash() ? "Join Call" : "Start Call";
  },

  roomIdFromHash() {
    const value = location.hash.replace(/^#/, "").trim();
    return /^[0-9a-f]{32}$/.test(value) ? value : null;
  },

  randomHex(byteLength) {
    const bytes = new Uint8Array(byteLength);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  },

  setStatus(text, dot) {
    this.els.statusText.textContent = text;
    this.els.statusDot.textContent = dot;
  },

  showInvite(visible) {
    this.els.inviteBox.hidden = !visible;
    if (visible) this.updateInviteLink();
  },

  updateInviteLink() {
    this.els.inviteUrl.value = location.href;
  },

  async copyInviteLink() {
    try {
      await navigator.clipboard.writeText(this.els.inviteUrl.value);
      this.setStatus("Invite link copied", "🟢");
    } catch {
      this.setStatus("Copy failed", "🟠");
    }
  },

  async onMainAction() {
    if (this.state.active) {
      this.endCall(true);
      return;
    }

    const existingRoom = this.roomIdFromHash();
    const host = !existingRoom;
    const roomId = existingRoom || this.randomHex(16);

    this.state.active = true;
    this.state.host = host;
    this.state.roomId = roomId;
    this.state.peerId = this.randomHex(8);
    this.state.peerJoined = false;

    this.els.button.disabled = true;

    if (host) {
      history.replaceState(null, "", `${location.pathname}#${roomId}`);
      this.showInvite(true);
      this.updateInviteLink();
      this.setStatus("Creating room...", "🟡");
    } else {
      this.showInvite(false);
      this.setStatus("Joining room...", "🟡");
    }

    try {
      await this.openSocket();
      this.sendSignal({
        type: "join",
        peerId: this.state.peerId,
        role: this.state.host ? "host" : "guest"
      });
      this.els.button.textContent = "End Call";
      this.els.button.disabled = false;
    } catch (error) {
      console.error(error);
      this.endCall(true);
      this.setStatus("Call ended", "🔴");
    }
  },

  openSocket() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(
        `${SIGNALING_BASE}/room/${this.state.roomId}?peer=${this.state.peerId}`
      );

      this.state.ws = ws;

      ws.onopen = () => {
        this.setStatus(this.state.host ? "Waiting for peer..." : "Joining room...", "🟡");
        resolve();
      };

      ws.onmessage = (event) => {
        this.onSignal(event.data).catch((error) => console.error(error));
      };

      ws.onerror = () => reject(new Error("WebSocket failed"));

      ws.onclose = () => {
        if (!this.state.active) return;
        this.endCall(true);
        this.setStatus("Call ended", "🔴");
      };
    });
  },

  sendSignal(payload) {
    if (!this.state.ws || this.state.ws.readyState !== WebSocket.OPEN) return;
    this.state.ws.send(JSON.stringify(payload));
  },

  async onSignal(raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    if (message.type === "join" && this.state.host) {
      if (!this.state.peerJoined) {
        this.state.peerJoined = true;
        this.sendSignal({
          type: "ack",
          peerId: this.state.peerId
        });
      }
      this.setStatus("Peer joined", "🟢");
      return;
    }

    if (message.type === "ack" && !this.state.host) {
      this.state.peerJoined = true;
      this.setStatus("Connected", "🟢");
      return;
    }
  },

  endCall(resetHash) {
    const ws = this.state.ws;

    this.state.active = false;
    this.state.host = false;
    this.state.roomId = null;
    this.state.peerId = null;
    this.state.peerJoined = false;
    this.state.ws = null;

    if (ws) {
      try {
        ws.close();
      } catch {}
    }

    if (resetHash) {
      history.replaceState(null, "", location.pathname + location.search);
    }

    this.showInvite(false);
    this.syncIdleUI();
    this.setStatus("Ready", "🟢");
  }
};

App.init();
