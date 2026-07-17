const SIGNALING_BASE = "wss://communication-first.communication-first-igor.workers.dev";
const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

const App = {
  els: {},
  state: {
    active: false,
    host: false,
    roomId: null,
    peerId: null,
    ws: null,
    pc: null,
    localStream: null,
    pendingCandidates: [],
    offerSent: false,
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
    window.addEventListener("beforeunload", () => this.endCall(false, true));

    this.syncIdleUI();
    this.setStatus("Ready", "🟢");
    this.showInvite(false);
  },

  syncIdleUI() {
    if (this.state.active) {
      this.els.button.textContent = "End Call";
      this.els.button.disabled = false;
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
      this.endCall(true, true);
      return;
    }

    const existingRoom = this.roomIdFromHash();
    const host = !existingRoom;
    const roomId = existingRoom || this.randomHex(16);

    this.state.active = true;
    this.state.host = host;
    this.state.roomId = roomId;
    this.state.peerId = this.randomHex(8);
    this.state.pendingCandidates = [];
    this.state.offerSent = false;

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
      await this.preparePeerConnection();
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
      this.endCall(true, false);
      this.setStatus("Call ended", "🔴");
    }
  },

  async preparePeerConnection() {
    this.setStatus("Requesting microphone...", "🟡");

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("getUserMedia is not available");
    }

    const localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    });

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    this.state.localStream = localStream;
    this.state.pc = pc;

    localStream.getTracks().forEach((track) => {
      pc.addTrack(track, localStream);
    });

    pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (!stream) return;
      this.els.remoteAudio.srcObject = stream;
      this.els.remoteAudio.play().catch(() => {});
    };

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      this.sendSignal({
        type: "candidate",
        candidate: event.candidate
      });
    };


    pc.oniceconnectionstatechange = () => {
      console.log("ICE state:", pc.iceConnectionState);
    };

    pc.onicegatheringstatechange = () => {
      console.log("ICE gathering:", pc.iceGatheringState);
    };

    pc.onconnectionstatechange = () => {
      console.log("Connection state:", pc.connectionState);

      if (!this.state.active) return;

      switch (pc.connectionState) {
        case "connected":
          this.setStatus("Connected", "🟢");
          break;
        case "connecting":
        case "new":
          this.setStatus("Negotiating...", "🟡");
          break;
        case "disconnected":
        case "failed":
        case "closed":
          this.setStatus("Call ended", "🔴");
          break;
      }
    };
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

      ws.onerror = () => {
        reject(new Error("WebSocket failed"));
      };

      ws.onclose = (event) => {
        console.log("WebSocket closed", event.code, event.reason);

        if (!this.state.active) return;
        this.endCall(true, false);
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
      this.setStatus("Peer joined", "🟢");

      if (!this.state.offerSent) {
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

      this.setStatus("Negotiating...", "🟡");
      return;
    }

    if (message.type === "answer" && this.state.host) {
      await this.state.pc.setRemoteDescription(message.description);
      await this.flushPendingCandidates();
      this.setStatus("Connected", "🟢");
      return;
    }

    if (message.type === "candidate") {
      const candidate = new RTCIceCandidate(message.candidate);

      if (this.state.pc.remoteDescription) {
        await this.state.pc.addIceCandidate(candidate);
      } else {
        this.state.pendingCandidates.push(candidate);
      }
      return;
    }

    if (message.type === "leave") {
      this.endCall(true, false);
      this.setStatus("Ready", "🟢");
    }
  },

  async createAndSendOffer() {
    if (!this.state.pc || this.state.offerSent) return;

    this.state.offerSent = true;
    this.setStatus("Negotiating...", "🟡");

    const offer = await this.state.pc.createOffer();
    await this.state.pc.setLocalDescription(offer);

    this.sendSignal({
      type: "offer",
      description: this.state.pc.localDescription
    });
  },

  async flushPendingCandidates() {
    while (this.state.pendingCandidates.length) {
      await this.state.pc.addIceCandidate(this.state.pendingCandidates.shift());
    }
  },

  endCall(resetHash, notifyPeer) {
    const ws = this.state.ws;
    const pc = this.state.pc;
    const stream = this.state.localStream;
    const peerId = this.state.peerId;

    if (notifyPeer && ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: "leave", peerId }));
      } catch {}
    }

    this.state.active = false;
    this.state.host = false;
    this.state.roomId = null;
    this.state.peerId = null;
    this.state.ws = null;
    this.state.pc = null;
    this.state.localStream = null;
    this.state.pendingCandidates = [];
    this.state.offerSent = false;

    if (ws) {
      try {
        ws.close();
      } catch {}
    }

    if (pc) {
      pc.ontrack = null;
      pc.onicecandidate = null;
      pc.onconnectionstatechange = null;
      try {
        pc.close();
      } catch {}
    }

    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }

    this.els.remoteAudio.srcObject = null;

    if (resetHash) {
      history.replaceState(null, "", location.pathname + location.search);
    }

    this.showInvite(false);
    this.syncIdleUI();
    this.setStatus("Ready", "🟢");
  }
};

App.init();
