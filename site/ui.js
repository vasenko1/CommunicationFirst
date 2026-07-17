export class AppUI {
  constructor() {
    this.button = document.getElementById("startCallBtn");
    this.statusText = document.getElementById("statusText");
    this.statusDot = document.getElementById("statusDot");
    this.inviteBox = document.getElementById("inviteBox");
    this.inviteUrl = document.getElementById("inviteUrl");
    this.copyButton = document.getElementById("copyInviteBtn");
    this.remoteAudio = document.getElementById("remoteAudio");
  }

  setStatus(text, dot = "🟢") {
    this.statusText.textContent = text;
    this.statusDot.textContent = dot;
  }

  setButtonText(text) {
    this.button.textContent = text;
  }

  setButtonDisabled(disabled) {
    this.button.disabled = disabled;
  }

  showInvite(visible) {
    this.inviteBox.hidden = !visible;
  }

  setInviteUrl(url) {
    this.inviteUrl.value = url;
  }

  async copyInviteLink() {
    await navigator.clipboard.writeText(this.inviteUrl.value);
  }

  attachRemoteStream(stream) {
    this.remoteAudio.srcObject = stream;
    this.remoteAudio.play().catch(() => {});
  }

  clearRemoteStream() {
    this.remoteAudio.srcObject = null;
  }
}
