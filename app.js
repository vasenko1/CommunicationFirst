import { createInitialState, CALL_STATES } from "./state.js";
import { AppUI } from "./ui.js";
import { SignalingClient } from "./signaling.js";
import { VoicePeer } from "./peer.js";
import { DebugPanel } from "./debug.js";

const SIGNALING_BASE = "wss://communication-first.communication-first-igor.workers.dev";
const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

function describeCandidate(candidate) {
  const raw = candidate?.candidate || "";
  const typeMatch = raw.match(/\btyp\s+([a-z]+)/i);
  const type = typeMatch?.[1] || "unknown";

  const addressMatch = raw.match(
    /^candidate:\S+\s+\d+\s+\S+\s+\d+\s+([^\s]+)\s+\d+\s+typ\s+[a-z]+/i
  );

  const address = addressMatch?.[1] || "";
  return address ? `${type} ${address}` : type;
}

class AppController {
  constructor() {
    this.state = createInitialState();
    this.ui = new AppUI();
    this.debug = new DebugPanel(document.getElementById("debugLog"));
    this.signaling = null;
    this.peer = null;
    this.init();
  }

  init() {
    this.ui.button.addEventListener("click", () => this.onMainAction());
    this.ui.copyButton.addEventListener("click", () => this.onCopyInvite());
    window.addEventListener("hashchange", () => this.syncIdleUI());
    window.addEventListener("beforeunload", () => this.endCall(false, true));

    this.syncIdleUI();
    this.ui.setStatus("Ready", "🟢");
    this.ui.showInvite(false);
    this.debug.log("App", "ready");
  }

  syncIdleUI() {
    if (this.state.active) {
      this.ui.setButtonText("End Call");
      this.ui.setButtonDisabled(false);
      return;
    }

    this.ui.setButtonDisabled(false);
    this.ui.setButtonText(this.roomIdFromHash() ? "Join Call" : "Start Call");
  }

  roomIdFromHash() {
    const value = location.hash.replace(/^#/, "").trim();
    return /^[0-9a-f]{32}$/.test(value) ? value : null;
  }

  randomHex(byteLength) {
    const bytes = new Uint8Array(byteLength);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  async onCopyInvite() {
    try {
      await this.ui.copyInviteLink();
      this.ui.setStatus("Invite link copied", "🟢");
      this.debug.log("UI", "invite copied");
    } catch (error) {
      console.error(error);
      this.ui.setStatus("Copy failed", "🟠");
      this.debug.log("UI", "copy failed");
    }
  }

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
    this.state.callState = CALL_STATES.REQUESTING_MICROPHONE;
    this.state.peerJoined = false;
    this.state.offerSent = false;
    this.state.pendingCandidates = [];

    this.ui.setButtonDisabled(true);

    if (host) {
      history.replaceState(null, "", `${location.pathname}#${roomId}`);
      this.ui.showInvite(true);
      this.ui.setInviteUrl(location.href);
      this.ui.setStatus("Creating room...", "🟡");
      this.debug.log("Call", `host room=${roomId}`);
    } else {
      this.ui.showInvite(false);
      this.ui.setStatus("Joining room...", "🟡");
      this.debug.log("Call", `guest room=${roomId}`);
    }

    try {
      await this.preparePeer();
      await this.connectSignaling();

      this.sendSignal({
        type: "join",
        peerId: this.state.peerId,
        role: this.state.host ? "host" : "guest"
      });

      this.ui.setButtonText("End Call");
      this.ui.setButtonDisabled(false);
    } catch (error) {
      console.error(error);
      this.debug.log("Error", String(error?.message || error));
      this.endCall(true, false);
      this.ui.setStatus("Call ended", "🔴");
    }
  }

  async preparePeer() {
    this.ui.setStatus("Requesting microphone...", "🟡");
    this.debug.log("Media", "requesting microphone");

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

    this.peer = new VoicePeer(ICE_SERVERS);
    await this.peer.init(localStream);
    this.state.localStream = localStream;
    this.state.pc = this.peer.pc;

    this.peer.addEventListener("track", (event) => {
      const stream = event.detail;
      if (!stream) return;
      this.ui.attachRemoteStream(stream);
      this.debug.log("Peer", "remote track attached");
    });

    this.peer.addEventListener("candidate", (event) => {
      this.debug.log("TX candidate", describeCandidate(event.detail));
      this.sendSignal({
        type: "candidate",
        candidate: event.detail
      });
    });

    this.peer.addEventListener("connectionstatechange", (event) => {
      const state = event.detail;
      this.debug.log("PC", state);

      if (!this.state.active) return;

      switch (state) {
        case "new":
        case "connecting":
          this.state.callState = CALL_STATES.NEGOTIATING;
          this.ui.setStatus("Negotiating...", "🟡");
          break;
        case "connected":
          this.state.callState = CALL_STATES.CONNECTED;
          this.ui.setStatus("Connected", "🟢");
          break;
        case "disconnected":
          this.state.callState = CALL_STATES.RECONNECTING;
          this.ui.setStatus("Reconnecting...", "🟡");
          break;
        case "failed":
        case "closed":
          this.state.callState = CALL_STATES.ENDED;
          this.endCall(true, false);
          this.ui.setStatus("Call ended", "🔴");
          break;
      }
    });

    this.peer.addEventListener("iceconnectionstatechange", (event) => {
      this.debug.log("ICE", event.detail);
    });

    this.peer.addEventListener("icegatheringstatechange", (event) => {
      this.debug.log("ICE gather", event.detail);
    });

    this.ui.setStatus("Microphone ready", "🟢");
    this.debug.log("Media", "microphone ready");
  }

  async connectSignaling() {
    this.state.callState = CALL_STATES.CONNECTING_SIGNALING;
    this.signaling = new SignalingClient(SIGNALING_BASE);

    this.signaling.addEventListener("open", () => {
      this.debug.log("WS", "open");
      this.ui.setStatus(this.state.host ? "Waiting for peer..." : "Joining room...", "🟡");
      this.state.callState = CALL_STATES.WAITING_FOR_PEER;
    });

    this.signaling.addEventListener("message", (event) => {
      this.onSignal(event.detail).catch((error) => {
        console.error(error);
        this.debug.log("Signal error", String(error?.message || error));
      });
    });

    this.signaling.addEventListener("close", (event) => {
      this.debug.log("WS", `close ${event.detail.code} ${event.detail.reason || ""}`.trim());

      if (!this.state.active) return;

      this.ui.setStatus("Signaling lost", "🟠");
    });

    this.signaling.addEventListener("error", () => {
      this.debug.log("WS", "error");
    });

    await this.signaling.connect(this.state.roomId, this.state.peerId);
  }

  sendSignal(payload) {
    if (!this.signaling) return;
    this.signaling.send(payload);
    this.debug.log("TX", payload.type);
  }

  async onSignal(raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    this.debug.log("RX", message.type);

    if (message.type === "join" && this.state.host) {
      this.state.peerJoined = true;
      this.ui.setStatus("Peer joined", "🟢");

      this.sendSignal({
        type: "peer-joined",
        peerId: this.state.peerId
      });

      if (!this.state.offerSent) {
        this.state.offerSent = true;
        this.ui.setStatus("Negotiating...", "🟡");
        const offer = await this.peer.createOffer();
        this.sendSignal({
          type: "offer",
          description: offer
        });
      }
      return;
    }

    if (message.type === "peer-joined" && !this.state.host) {
      this.state.peerJoined = true;
      this.ui.setStatus("Negotiating...", "🟡");

      this.sendSignal({
        type: "peer-ready",
        peerId: this.state.peerId
      });
      return;
    }

    if (message.type === "peer-ready" && this.state.host) {
      this.ui.setStatus("Negotiating...", "🟡");
      return;
    }

    if (message.type === "offer" && !this.state.host) {
      await this.peer.setRemoteDescription(message.description);
      const answer = await this.peer.createAnswer();
      this.sendSignal({
        type: "answer",
        description: answer
      });
      return;
    }

    if (message.type === "answer" && this.state.host) {
      await this.peer.setRemoteDescription(message.description);
      return;
    }

    if (message.type === "candidate") {
      this.debug.log("RX candidate", describeCandidate(message.candidate));
      await this.peer.addCandidate(message.candidate);
      return;
    }

    if (message.type === "leave") {
      this.debug.log("Call", "peer left");
      this.endCall(true, false);
      this.ui.setStatus("Ready", "🟢");
    }
  }

  endCall(resetHash, notifyPeer) {
    const ws = this.signaling;
    const peer = this.peer;
    const peerId = this.state.peerId;

    if (notifyPeer && ws) {
      try {
        ws.send({
          type: "leave",
          peerId
        });
        this.debug.log("TX", "leave");
      } catch {}
    }

    this.state = createInitialState();
    this.signaling = null;
    this.peer = null;

    if (ws) {
      try {
        ws.close();
      } catch {}
    }

    if (peer) {
      peer.close();
      peer.stopLocalTracks();
    }

    this.ui.clearRemoteStream();

    if (resetHash) {
      history.replaceState(null, "", location.pathname + location.search);
    }

    this.ui.showInvite(false);
    this.syncIdleUI();
  }
}

new AppController();
