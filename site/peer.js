export class VoicePeer extends EventTarget {
  constructor(iceServers) {
    super();
    this.iceServers = iceServers;
    this.pc = null;
    this.localStream = null;
    this.pendingCandidates = [];
  }

  async init(localStream) {
    this.localStream = localStream;
    this.pc = new RTCPeerConnection({ iceServers: this.iceServers });

    localStream.getTracks().forEach((track) => {
      this.pc.addTrack(track, localStream);
    });

    this.pc.ontrack = (event) => {
      this.dispatchEvent(
        new CustomEvent("track", { detail: event.streams[0] || null })
      );
    };

    this.pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      this.dispatchEvent(
        new CustomEvent("candidate", { detail: event.candidate })
      );
    };

    this.pc.onconnectionstatechange = () => {
      this.dispatchEvent(
        new CustomEvent("connectionstatechange", {
          detail: this.pc.connectionState
        })
      );
    };

    this.pc.oniceconnectionstatechange = () => {
      this.dispatchEvent(
        new CustomEvent("iceconnectionstatechange", {
          detail: this.pc.iceConnectionState
        })
      );
    };

    this.pc.onicegatheringstatechange = () => {
      this.dispatchEvent(
        new CustomEvent("icegatheringstatechange", {
          detail: this.pc.iceGatheringState
        })
      );
    };
  }

  async createOffer(options = {}) {
    const offer = await this.pc.createOffer(options);
    await this.pc.setLocalDescription(offer);
    return this.pc.localDescription;
  }

  async createAnswer() {
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    return this.pc.localDescription;
  }

  async setRemoteDescription(description) {
    await this.pc.setRemoteDescription(description);
    await this.flushPendingCandidates();
  }

  async addCandidate(candidate) {
    const iceCandidate = new RTCIceCandidate(candidate);
    if (this.pc.remoteDescription) {
      await this.pc.addIceCandidate(iceCandidate);
    } else {
      this.pendingCandidates.push(iceCandidate);
    }
  }

  async flushPendingCandidates() {
    while (this.pendingCandidates.length) {
      await this.pc.addIceCandidate(this.pendingCandidates.shift());
    }
  }

  close() {
    if (!this.pc) return;

    this.pc.ontrack = null;
    this.pc.onicecandidate = null;
    this.pc.onconnectionstatechange = null;
    this.pc.oniceconnectionstatechange = null;
    this.pc.onicegatheringstatechange = null;

    try {
      this.pc.close();
    } catch {}

    this.pc = null;
  }

  stopLocalTracks() {
    if (!this.localStream) return;
    this.localStream.getTracks().forEach((track) => track.stop());
    this.localStream = null;
  }
}
