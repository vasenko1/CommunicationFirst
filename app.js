const SIGNALING_BASE = "wss://communication-first.communication-first-igor.workers.dev";
const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

const App = {
  els: {},
  state: {
    active: false,
    host: false,
    roomId: null,
    peerId: null,
    remoteReady: false,
    offerSent: false,
    pendingCandidates: [],
    localStream: null,
    pc: null,
    ws: null,
  },

  init() {
    this.els.button = document.getElementById("startCallBtn");
    this.els.statusText = document.getElementById("statusText");
    this.els.statusDot = document.getElementById("statusDot");
    this.els.inviteBox = document.getElementById("inviteBox");
    this.els.inviteUrl = document.getElementById("inviteUrl");
    this.els.copyButton = document.getElementById("copyInviteBtn");
    this.els.remoteAudio = document.getElementById("remoteAudio");

    this.els.button.addEventListener("click", () => this.onMainAction());
    this.els.copyButton.addEventListener("click", () => this.copyInviteLink());
    window.addEventListener("hashchange", () => this.syncIdleUI());
    window.addEventListener("beforeunload", () => this.finishCall(true));

    this.syncIdleUI();
    this.setStatus("Ready", "🟢");
    this.showInvite(false);
  },

  syncIdleUI() {
    if (this.state.active) return;
    this.els.button.textContent = this.roomIdFromHash() ? "Join Call" : "Start Call";
    this.els.button.disabled = false;
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
      this.finishCall(true);
      this.setStatus("Call ended", "🔴");
      return;
    }

    const existingRoom = this.roomIdFromHash();
    const host = !existingRoom;
    const roomId = existingRoom || this.randomHex(16);

    this.state.active = true;
    this.state.host = host;
    this.state.roomId = roomId;
    this.state.peerId = this.randomHex(8);
    this.state.remoteReady = false;
    this.state.offerSent = false;
    this.state.pendingCandidates = [];

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
      await this.setupMediaAndPeer();
      await this.openSocket();
      this.sendSignal({ type: "ready" });
      this.els.button.textContent = "End Call";
      this.els.button.disabled = false;
    } catch (error) {
      console.error(error);
      this.finishCall(true);
      this.setStatus("Call ended", "🔴");
    }
  },

  async setupMediaAndPeer() {
    this.state.localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    });

    this.state.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    this.state.localStream.getTracks().forEach((track) => {
      this.state.pc.addTrack(track, this.state.localStream);
    });

    this.state.pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (!stream) return;
      this.els.remoteAudio.srcObject = stream;
      this.els.remoteAudio.play().catch(() => {});
    };

    this.state.pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      this.sendSignal({
        type: "candidate",
        candidate: event.candidate
      });
    };

    this.state.pc.onconnectionstatechange = () => {
      if (!this.state.pc) return;
      const state = this.state.pc.connectionState;
      if (state === "connected") {
        this.setStatus("Connected", "🟢");
      } else if (state === "connecting" || state === "new") {
        this.setStatus("Connecting...", "🟡");
      } else if (state === "disconnected" || state === "failed" || state === "closed") {
        this.setStatus("Call ended", "🔴");
      }
    };
  },

  openSocket() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${SIGNALING_BASE}/room/${this.state.roomId}?peer=${this.state.peerId}`);
      this.state.ws = ws;

      ws.onopen = () => {
        this.setStatus(this.state.host ? "Waiting for peer..." : "Joining room...", "🟡");
        resolve();
      };

      ws.onmessage = (event) => {
        this.onSignal(event.data).catch((error) => console.error(error));
      };

      ws.onerror = () => {
        reject(new Error("WebSocket failed"));
      };

      ws.onclose = () => {
        if (!this.state.active) return;
        this.setStatus("Call ended", "🔴");
        this.finishCall(true);
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

    if (message.type === "ready") {
      this.state.remoteReady = true;
      if (this.state.host && !this.state.offerSent) {
        await this.createAndSendOffer();
      }
      return;
    }

    if (message.type === "offer" && !this.state.host) {
      await this.state.pc.setRemoteDescription(message.description);
      await this.flushPendingCandidates();

      const answer = await this.state.pc.createAnswer();
      await this.state.pc.setLocalDescription(answer);
      this.sendSignal({
        type: "answer",
        description: this.state.pc.localDescription
      });
      this.setStatus("Connecting...", "🟡");
      return;
    }

    if (message.type === "answer" && this.state.host) {
      await this.state.pc.setRemoteDescription(message.description);
      await this.flushPendingCandidates();
      return;
    }

    if (message.type === "candidate") {
      const candidate = new RTCIceCandidate(message.candidate);
      if (this.state.pc.remoteDescription) {
        await this.state.pc.addIceCandidate(candidate);
      } else {
        this.state.pendingCandidates.push(candidate);
      }
    }
  },

  async flushPendingCandidates() {
    while (this.state.pendingCandidates.length) {
      await this.state.pc.addIceCandidate(this.state.pendingCandidates.shift());
    }
  },

  async createAndSendOffer() {
    if (!this.state.pc || this.state.offerSent) return;
    this.state.offerSent = true;
    this.setStatus("Connecting...", "🟡");

    const offer = await this.state.pc.createOffer();
    await this.state.pc.setLocalDescription(offer);

    this.sendSignal({
      type: "offer",
      description: this.state.pc.localDescription
    });
  },

  finishCall(resetHash) {
    const ws = this.state.ws;
    const pc = this.state.pc;
    const stream = this.state.localStream;

    this.state.active = false;
    this.state.host = false;
    this.state.remoteReady = false;
    this.state.offerSent = false;
    this.state.pendingCandidates = [];
    this.state.ws = null;
    this.state.pc = null;
    this.state.localStream = null;

    if (ws) {
      try { ws.close(); } catch {}
    }

    if (pc) {
      pc.ontrack = null;
      pc.onicecandidate = null;
      pc.onconnectionstatechange = null;
      try { pc.close(); } catch {}
    }

    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }

    this.els.remoteAudio.srcObject = null;
    this.showInvite(false);

    if (resetHash) {
      history.replaceState(null, "", location.pathname + location.search);
    }

    this.syncIdleUI();
    this.setStatus("Ready", "🟢");
  }
};

App.init();
