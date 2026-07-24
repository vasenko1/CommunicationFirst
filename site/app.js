import { createInitialState, END_REASONS } from "./state.js";
import { AppUI } from "./ui.js";
import { SignalingSession } from "./signaling.js";
import { VoicePeer } from "./peer.js";
import { DebugPanel } from "./debug.js";
import { RecoveryController, RECOVERY_EVENTS, RECOVERY_ACTIONS } from "./recovery.js";

const SIGNALING_BASE = "wss://communication-first.communication-first-igor.workers.dev";
const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

function describeCandidate(candidate) {
  const raw = candidate?.candidate || "";
  const typeMatch = raw.match(/\btyp\s+([a-z]+)/i);
  const type = typeMatch?.[1] || candidate?.candidateType || "unknown";

  const address =
    candidate?.address ||
    candidate?.ip ||
    candidate?.relatedAddress ||
    "";

  const port = candidate?.port ? `:${candidate.port}` : "";
  const protocol = candidate?.protocol ? `/${candidate.protocol}` : "";

  return [type, address ? `${address}${port}` : "", protocol]
    .filter(Boolean)
    .join(" ")
    .trim();
}

function fmtNumber(value) {
  return Number.isFinite(value) ? value.toFixed(3) : "n/a";
}

const END_STATUS = {
  [END_REASONS.USER]: { text: "Разговор завершён", dot: "🟢" },
  [END_REASONS.PEER]: { text: "Собеседник завершил разговор", dot: "🟢" },
  [END_REASONS.NETWORK]: { text: "Соединение потеряно", dot: "🔴" },
  [END_REASONS.ERROR]: { text: "Ошибка соединения", dot: "🔴" },
};

class AppController {
  constructor() {
    this.state = createInitialState();
    this.ui = new AppUI();
    this.debug = new DebugPanel(document.getElementById("debugLog"));
    this.recovery = new RecoveryController();
    this.signaling = null;
    this.peer = null;
    this.offerSent = false;
    this.iceRestarting = false;
    this.statsTimer = null;
    this.reconnectTimer = null;
    this.recoveryVerificationTimer = null;
    this.recoveryAttempts = 0;
    this.maxRecoveryAttempts = 3;
    this.init();
  }

  init() {
    this.ui.button.addEventListener("click", () => this.onMainAction());
    this.ui.copyButton.addEventListener("click", () => this.onCopyInvite());
    document.getElementById("copyDebugBtn")?.addEventListener("click", () => this.onCopyDebug());
    window.addEventListener("hashchange", () => this.syncIdleUI());
    window.addEventListener("beforeunload", () => this.endCall(false, true, END_REASONS.USER));

    this.syncIdleUI();
    this.ui.setStatus("Готово", "🟢");
    this.ui.showInvite(false);
    this.debug.log("Приложение", "готово");
  }

  syncIdleUI() {
    if (this.state.active) {
      this.ui.setButtonText("Завершить");
      this.ui.setButtonDisabled(false);
      return;
    }

    this.ui.setButtonDisabled(false);
    this.ui.setButtonText(this.roomIdFromHash() ? "Присоединиться" : "Позвонить");
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
      this.ui.setStatus("Ссылка скопирована", "🟢");
      this.debug.log("Интерфейс", "ссылка приглашения скопирована");
    } catch (error) {
      console.error(error);
      this.ui.setStatus("Не удалось скопировать", "🟠");
      this.debug.log("Интерфейс", "ошибка копирования ссылки");
    }
  }

  async onCopyDebug() {
    try {
      await this.debug.copyToClipboard();
      this.ui.setStatus("Журнал скопирован", "🟢");
      this.debug.log("Интерфейс", "журнал скопирован");
    } catch (error) {
      console.error(error);
      this.ui.setStatus("Не удалось скопировать журнал", "🟠");
      this.debug.log("Интерфейс", "ошибка копирования журнала");
    }
  }

  async onMainAction() {
    if (this.state.active) {
      this.endCall(true, true, END_REASONS.USER);
      return;
    }

    const existingRoom = this.roomIdFromHash();
    const host = !existingRoom;
    const roomId = existingRoom || this.randomHex(16);

    this.state.active = true;
    this.state.host = host;
    this.state.roomId = roomId;
    this.state.peerId = this.randomHex(8);
    this.offerSent = false;
    this.iceRestarting = false;

    this.ui.setButtonDisabled(true);

    if (host) {
      history.replaceState(null, "", `${location.pathname}#${roomId}`);
      this.ui.showInvite(true);
      this.ui.setInviteUrl(location.href);
      this.ui.setStatus("Создание комнаты...", "🟡");
      this.debug.log("Разговор", `хост room=${roomId}`);
    } else {
      this.ui.showInvite(false);
      this.ui.setStatus("Подключение...", "🟡");
      this.debug.log("Разговор", `гость room=${roomId}`);
    }

    try {
      await this.preparePeer();
      await this.connectSignaling();

      this.ui.setButtonText("Завершить");
      this.ui.setButtonDisabled(false);
    } catch (error) {
      console.error(error);
      this.debug.log("Ошибка", String(error?.message || error));
      this.endCall(true, false, END_REASONS.ERROR);
    }
  }

  async preparePeer() {
    this.ui.setStatus("Запрос микрофона...", "🟡");
    this.debug.log("Микрофон", "запрос");

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

    this.peer.addEventListener("track", (event) => {
      const stream = event.detail;
      if (!stream) return;
      this.ui.attachRemoteStream(stream);
      this.debug.log("Peer", "удалённый звук подключён");
    });

    this.peer.addEventListener("candidate", (event) => {
      const candidate = event.detail;
      this.debug.log("TX candidate", describeCandidate(candidate));
      this.sendSignal({
        type: "candidate",
        candidate
      });
    });

      this.peer.addEventListener("connectionstatechange", (event) => {
          const state = event.detail;
          this.debug.log("PC", state);

          if (!this.state.active) return;

          switch (state) {
              case "new":
              case "connecting":
                  this.ui.setStatus("Соединение...", "🟡");
                  break;

              case "connected":
                  this.emitRecoveryEvent(RECOVERY_EVENTS.PEER_CONNECTED);
                  this.scheduleConnectionVerification();
                  this.iceRestarting = false;

                  if (this.reconnectTimer) {
                      clearTimeout(this.reconnectTimer);
                      this.reconnectTimer = null;
                  }

                  this.stopStatsPolling();
                  this.ui.setStatus("Разговор", "🟢");
                  this.startStatsPolling();
                  break;

              case "disconnected":
                  if (this.recoveryVerificationTimer) {
                      clearTimeout(this.recoveryVerificationTimer);
                      this.recoveryVerificationTimer = null;
                  }
                  this.emitRecoveryEvent(RECOVERY_EVENTS.PEER_DISCONNECTED);
                  
                  if (!this.reconnectTimer) {
                      this.reconnectTimer = setTimeout(() => {
                          this.reconnectTimer = null;

                          const action = this.emitRecoveryEvent(
                              RECOVERY_EVENTS.DISCONNECT_DEBOUNCE_EXPIRED
                          );

                          if (action === RECOVERY_ACTIONS.START_ICE_RESTART) {
                              this.attemptIceRecovery();
                          }
                      }, 2000);
                  }
                  break;

              case "failed":
                  if (this.recoveryVerificationTimer) {
                      clearTimeout(this.recoveryVerificationTimer);
                      this.recoveryVerificationTimer = null;
                  }
                  const action = this.emitRecoveryEvent(RECOVERY_EVENTS.PEER_FAILED);
                  
                  if (action === RECOVERY_ACTIONS.START_ICE_RESTART) {
                      this.attemptIceRecovery();
                  }
                  if (this.reconnectTimer) {
                      clearTimeout(this.reconnectTimer);
                      this.reconnectTimer = null;
                  }
                  this.stopStatsPolling();
                  this.ui.setStatus("Восстанавливаем соединение...", "🟠");
                  break;

              case "closed":
                  if (this.reconnectTimer) {
                      clearTimeout(this.reconnectTimer);
                      this.reconnectTimer = null;
                  }
                  this.stopStatsPolling();
                  this.endCall(false, false, END_REASONS.NETWORK);
                  break;
          }
      });

      this.peer.addEventListener("iceconnectionstatechange", (event) => {
          const state = event.detail;

          this.debug.log("ICE", state);

          if (!this.state.active) return;

          switch (state) {
              case "checking":
              case "connected":
              case "completed":
              case "disconnected":
              case "failed":
              case "closed":
                  this.debug.log("ICE FSM", state);
                  break;
          }
      });

    this.peer.addEventListener("icegatheringstatechange", (event) => {
      this.debug.log("ICE gather", event.detail);
    });

    this.ui.setStatus("Микрофон готов", "🟢");
    this.debug.log("Микрофон", "готов");
  }

    async connectSignaling() {
        this.signaling = new SignalingSession(SIGNALING_BASE);
        this.signaling.addEventListener("trace", (event) => {
            const d = event.detail || {};

            if (d.kind === "recv") {
                this.debug.log("WS RECV", `${d.type} ${d.size}`);
                return;
            }

            if (d.kind === "send-ok") {
                this.debug.log("WS SEND OK", `${d.type} ${d.size}`);
                return;
            }

            if (d.kind === "send-failed") {
                this.debug.log("WS SEND FAILED", `${d.type} ${d.reason}`);
                return;
            }

            if (d.kind === "send-error") {
                this.debug.log("WS SEND ERROR", `${d.type} ${d.error}`);
            }

            if (d.kind === "heartbeat-start") {
                this.debug.log("Heartbeat", "started");
                return;
            }

            if (d.kind === "heartbeat-timeout") {
                this.debug.log("Heartbeat", "timeout");
                return;
            }

            if (d.kind === "heartbeat-reconnect") {
                this.debug.log("Heartbeat", "reconnect");
                return;
            }
        });

        this.signaling.addEventListener("connected", (event) => {
            const reconnect = Boolean(event.detail?.reconnect);
            this.debug.log("WS", reconnect ? "reconnected" : "open");

            if (!this.state.active) return;

            if (reconnect) {
                this.ui.setStatus("Восстанавливаем служебной канал...", "🟠");

                const action = this.emitRecoveryEvent(RECOVERY_EVENTS.TRANSPORT_CONNECTED);
                if (action === RECOVERY_ACTIONS.START_ICE_RESTART) {
                    this.attemptIceRecovery();
                }
            }

            this.sendSignal({
                type: "join",
                peerId: this.state.peerId,
                role: this.state.host ? "host" : "guest"
            });
        });
    
        this.signaling.addEventListener("statechange", (event) => {
            const state = event.detail?.state;
            if (!state) return;
    
            this.debug.log("WS state", state);
    
            if (!this.state.active) return;
    
            if (state === "reconnecting") {
                this.emitRecoveryEvent(
                    RECOVERY_EVENTS.TRANSPORT_RECONNECTING
                );
                this.ui.setStatus("Восстанавливаем служебный канал...", "🟠");
            }
        });
    
        this.signaling.addEventListener("message", (event) => {
            this.onSignal(event.detail).catch((error) => {
                console.error(error);
                this.debug.log("Ошибка сигнала", String(error?.message || error));
            });
        });
    
        this.signaling.addEventListener("close", (event) => {
            this.debug.log(
                "WS",
                `close ${event.detail.code} ${event.detail.reason || ""}`.trim()
            );
        });
    
        this.signaling.addEventListener("failed", () => {
            this.debug.log("WS", "failed");
            if (!this.state.active) return;
            this.endCall(false, false, END_REASONS.NETWORK);
        });
    
        this.signaling.addEventListener("error", () => {
            this.debug.log("WS", "error");
        });
    
        await this.signaling.connect(this.state.roomId, this.state.peerId);
    }

    sendSignal(payload) {
        if (!this.signaling) return;

        const ok = this.signaling.send(payload);

        this.debug.log(
            ok ? "TX" : "TX FAILED",
            payload.type
        );
    }

    emitRecoveryEvent(type) {
        const previousState = this.recovery.state;
        const action = this.recovery.handle({ type });

        this.debug.log(
            "Recovery FSM",
            `${previousState} + ${type} -> ${this.recovery.state}`
        );

        if (
            action !== RECOVERY_ACTIONS.NONE &&
            (action !== RECOVERY_ACTIONS.START_ICE_RESTART || this.state.host)
        ) {
            this.debug.log("Recovery decision", action);
        }
        return action;
    }

    scheduleConnectionVerification() {
        if (this.recoveryVerificationTimer) {
            clearTimeout(this.recoveryVerificationTimer);
            this.recoveryVerificationTimer = null;
        }

        if (!this.recovery.isVerifyingConnection()) {
            return;
        }

        this.recoveryVerificationTimer = setTimeout(() => {
            this.recoveryVerificationTimer = null;

            if (!this.state.active) return;

            this.emitRecoveryEvent(
                RECOVERY_EVENTS.CONNECTION_VERIFIED
            );

            this.recoveryAttempts = 0;
            this.debug.log("Recovery", "connection verified");
            
        }, 2000);
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
      this.ui.setStatus("Собеседник подключился", "🟢");

      this.sendSignal({
        type: "peer-joined",
        peerId: this.state.peerId
      });
      
      return;
    }

    if (message.type === "join" && !this.state.host) {
      this.ui.setStatus("Соединение...", "🟡");

      this.sendSignal({
        type: "peer-ready",
        peerId: this.state.peerId,
      });
      return;
    }

    if (message.type === "peer-joined" && !this.state.host) {
      this.ui.setStatus("Соединение...", "🟡");

      this.sendSignal({
        type: "peer-ready",
        peerId: this.state.peerId
      });
      return;
    }

      if (message.type === "peer-ready" && this.state.host) {
          this.ui.setStatus("Соединение...", "🟡");

          const iceRestart = this.recovery.shouldRestartIce();

          await this.createAndSendOffer({ iceRestart });
          return;
      }

      if (message.type === "offer" && !this.state.host) {
          const restartOffer = this.recovery.shouldRestartIce();
          this.debug.log(
              "Recovery",
              restartOffer
                  ? "RX restart offer"
                  : "RX offer"
          );

          try {
              await this.peer.setRemoteDescription(message.description);

              this.debug.log(
                  "Recovery",
                  restartOffer
                      ? "Restart offer applied"
                      : "Offer applied"
              );

              const answer = await this.peer.createAnswer();

              this.debug.log(
                  "Recovery",
                  restartOffer
                      ? "TX restart answer"
                      : "TX answer"
              );

              this.sendSignal({
                  type: "answer",
                  description: answer
              });
          } catch (error) {
              this.offerSent = false;
              this.iceRestarting = false;
              this.debug.log("Recovery ERROR", String(error?.message || error));
              throw error;
          }

          return;
      }

      if (message.type === "answer" && this.state.host) {
          this.debug.log("Recovery", "RX answer");

          try {
              await this.peer.setRemoteDescription(message.description);
              this.debug.log("Recovery", "Answer applied");
          } catch (error) {
              this.offerSent = false;
              this.iceRestarting = false;
              this.debug.log("Recovery ERROR", String(error?.message || error));
              throw error;
          }

          this.ui.setStatus("Разговор", "🟢");
          return;
      }

    if (message.type === "candidate") {
      this.debug.log("RX candidate", describeCandidate(message.candidate));
      await this.peer.addCandidate(message.candidate);
      return;
    }

    if (message.type === "leave") {
      this.debug.log("Разговор", "собеседник завершил разговор");
      this.stopStatsPolling();
      this.endCall(false, false, END_REASONS.PEER);
    }
  }

    async createAndSendOffer({ iceRestart = false } = {}) {
        if (!this.peer?.pc || this.offerSent) return;

        this.offerSent = true;
        this.ui.setStatus("Соединение...", "🟡");

        try {
            const offer = await this.peer.createOffer({ iceRestart });

            this.sendSignal({
                type: "offer",
                description: offer
            });
        } catch (error) {
            this.offerSent = false;
            throw error;
        }
    }

    startIceRestart() {
        if (this.recoveryAttempts >= this.maxRecoveryAttempts) {
            this.debug.log("Recovery", "giving up");
            this.endCall(false, false, END_REASONS.NETWORK);
            return;
        }

        if (this.iceRestarting) return;

        this.stopStatsPolling();
        this.ui.setStatus("Восстанавливаем соединение...", "🟠");
        this.offerSent = false;
        this.iceRestarting = true;
        this.recoveryAttempts += 1;

        this.debug.log("Recovery", `starting ICE restart #${this.recoveryAttempts}`);

        void this.createAndSendOffer({ iceRestart: true }).catch((error) => {
            this.offerSent = false;
            this.iceRestarting = false;
            this.debug.log("Recovery ERROR", String(error?.message || error));

            if (this.recoveryAttempts >= this.maxRecoveryAttempts) {
                this.debug.log("Recovery", "giving up");
                this.endCall(false, false, END_REASONS.NETWORK);
                return;
            }

            if (!this.reconnectTimer) {
                this.reconnectTimer = setTimeout(() => {
                    this.reconnectTimer = null;
                    this.attemptIceRecovery();
                }, 2000);
            }
        });
    }

    attemptIceRecovery() {
        if (!this.state.active || !this.state.host) {
            return;
        }

        if (this.signaling?.state !== "connected") {
            return;
        }

        this.startIceRestart();
    }

  async updateStats() {
    if (!this.state.active || !this.peer?.pc) return;

    try {
      const stats = await this.peer.pc.getStats();
      const localCandidates = new Map();
      const remoteCandidates = new Map();
      let selectedPair = null;

      stats.forEach((report) => {
        if (report.type === "local-candidate") {
          localCandidates.set(report.id, report);
        } else if (report.type === "remote-candidate") {
          remoteCandidates.set(report.id, report);
        }
      });

      stats.forEach((report) => {
        if (report.type !== "candidate-pair") return;
        if (report.selected || report.nominated || report.state === "succeeded") {
          if (!selectedPair || report.selected) {
            selectedPair = report;
          }
        }
      });

      if (!selectedPair) {
        this.debug.log("Stats", "no selected candidate pair");
        return;
      }

      const local = localCandidates.get(selectedPair.localCandidateId);
      const remote = remoteCandidates.get(selectedPair.remoteCandidateId);

      this.debug.log(
        "Stats",
        `pair=${selectedPair.state || "unknown"} local=${describeCandidate(local)} remote=${describeCandidate(remote)} rtt=${fmtNumber(selectedPair.currentRoundTripTime)}`
      );
    } catch (error) {
      this.debug.log("Stats error", String(error?.message || error));
    }
  }

  startStatsPolling() {
    if (this.statsTimer) return;

    this.statsTimer = setInterval(() => {
      void this.updateStats();
    }, 1000);

    void this.updateStats();
    this.debug.log("Stats", "polling started");
  }

  stopStatsPolling() {
    if (!this.statsTimer) return;
    clearInterval(this.statsTimer);
    this.statsTimer = null;
    this.debug.log("Stats", "polling stopped");
  }

  endCall(resetHash, notifyPeer, reason) {
    const ws = this.signaling;
    const peer = this.peer;
    const peerId = this.state.peerId;

      if (this.recoveryVerificationTimer) {
          clearTimeout(this.recoveryVerificationTimer);
          this.recoveryVerificationTimer = null;
      }

    this.stopStatsPolling();

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
      this.recoveryAttempts = 0;
      this.iceRestarting = false;
      this.recovery.reset();
      if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
      }
    this.signaling = null;
    this.peer = null;
    this.offerSent = false;

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

    const ended = END_STATUS[reason];
    this.ui.setStatus(ended.text, ended.dot);
  }
}

new AppController();
