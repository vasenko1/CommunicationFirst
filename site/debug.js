export class DebugPanel {
  constructor(logElement) {
    this.logElement = logElement;
    this.lines = [];
    this.maxLines = 20;
    this.render();
  }

  clear() {
    this.lines = [];
    this.render();
  }

  log(label, value) {
    const time = new Date().toLocaleTimeString();
    const suffix =
      value === undefined
        ? ""
        : typeof value === "string"
          ? ` ${value}`
          : ` ${JSON.stringify(value)}`;
    this.lines.unshift(`[${time}] ${label}${suffix}`);
    this.lines = this.lines.slice(0, this.maxLines);
    this.render();
  }

  render() {
    if (!this.logElement) return;
    this.logElement.textContent = this.lines.length
      ? this.lines.join("\n")
      : "Waiting for events...";
  }
}
