const App = {

  statusElement: null,

  init() {
    this.statusElement = document.getElementById("statusText");

    document
      .getElementById("startCallBtn")
      .addEventListener("click", () => this.startCall());
  },

  updateStatus(text) {
    this.statusElement.textContent = text;
  },

  startCall() {
    this.updateStatus("Coming soon...");
  }

};

App.init();
