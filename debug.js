export class DebugPanel {
  constructor(logElement) {
    this.logElement = logElement;
    this.lines = [];
    this.maxLines = 40;
    this.render();
  }

  clear() {
    this.lines = [];
    this.render();
  }

  log(label, value) {
    const time = new Date().toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

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

  getText() {
    return this.lines.join("\n");
  }

  async copyToClipboard() {
    const text = this.getText();
    if (!text) {
      throw new Error("No logs to copy");
    }
    await navigator.clipboard.writeText(text);
  }

  render() {
    if (!this.logElement) return;
    this.logElement.textContent = this.lines.length
      ? this.lines.join("\n")
      : "Ожидание событий...";
  }
}
