import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

const BASE = "https://signaling.test";

const room = (c) => c.repeat(32);
const peer = (c) => c.repeat(16);

async function open(roomId, peerId) {
  const response = await SELF.fetch(
    `${BASE}/room/${roomId}?peer=${peerId}`,
    {
      headers: {
        Upgrade: "websocket"
      }
    }
  );

  if (response.status !== 101 || !response.webSocket) {
    return {
      status: response.status,
      ws: null
    };
  }

  response.webSocket.accept();

  return {
    status: response.status,
    ws: response.webSocket
  };
}

function nextMessage(ws, timeout = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("timeout waiting for message")),
      timeout
    );

    ws.addEventListener(
      "message",
      (event) => {
        clearTimeout(timer);
        resolve(event.data);
      },
      { once: true }
    );
  });
}

function nextClose(ws, timeout = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("timeout waiting for close")),
      timeout
    );

    ws.addEventListener(
      "close",
      (event) => {
        clearTimeout(timer);
        resolve(event);
      },
      { once: true }
    );
  });
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe("Communication First signaling", () => {

  it("returns health status", async () => {
    const response = await SELF.fetch(`${BASE}/health`);

    expect(response.status).toBe(200);

    expect(await response.json()).toMatchObject({
      status: "ok",
      version: 1
    });
  });

  it("relays messages between two peers", async () => {
    const roomId = room("1");

    const first = await open(roomId, peer("a"));
    const second = await open(roomId, peer("b"));

    expect(first.status).toBe(101);
    expect(second.status).toBe(101);

    const message = nextMessage(second.ws);

    first.ws.send(
      JSON.stringify({
        type: "offer",
        sdp: "..."
      })
    );

    expect(await message).toBe(
      JSON.stringify({
        type: "offer",
        sdp: "..."
      })
    );

    first.ws.close();
    second.ws.close();
  });

  it("rejects invalid room id", async () => {
    const response = await SELF.fetch(
      `${BASE}/room/not-valid`,
      {
        headers: {
          Upgrade: "websocket"
        }
      }
    );

    expect(response.status).toBe(400);
  });

  it("rejects invalid peer id", async () => {
    const response = await SELF.fetch(
      `${BASE}/room/${room("2")}?peer=BAD`,
      {
        headers: {
          Upgrade: "websocket"
        }
      }
    );

    expect(response.status).toBe(400);
  });

  it("rejects third peer", async () => {
    const roomId = room("3");

    const first = await open(roomId, peer("a"));
    const second = await open(roomId, peer("b"));

    expect(first.status).toBe(101);
    expect(second.status).toBe(101);

    const third = await open(roomId, peer("c"));

    expect(third.status).toBe(409);
    expect(third.ws).toBeNull();

    first.ws.close();
    second.ws.close();
  });

  it("closes oversized messages", async () => {
    const roomId = room("4");

    const first = await open(roomId, peer("a"));

    expect(first.status).toBe(101);

    const closed = nextClose(first.ws);

    first.ws.send("x".repeat(64 * 1024 + 1));

    expect((await closed).code).toBe(1009);
  });

  it("replaces stale socket during reconnect", async () => {
    const roomId = room("5");
    const peerId = peer("a");

    const first = await open(roomId, peerId);

    expect(first.status).toBe(101);

    const closed = nextClose(first.ws);

    const second = await open(roomId, peerId);

    expect(second.status).toBe(101);

    expect((await closed).code).toBe(1000);

    const third = await open(roomId, peer("b"));

    expect(third.status).toBe(101);

    second.ws.close();
    third.ws.close();
  });

  it("allows another peer after one disconnects", async () => {
    const roomId = room("6");

    const first = await open(roomId, peer("a"));
    const second = await open(roomId, peer("b"));

    expect(first.status).toBe(101);
    expect(second.status).toBe(101);

    first.ws.close();

    await nextClose(first.ws);

    const third = await open(roomId, peer("c"));

    expect(third.status).toBe(101);

    second.ws.close();
    third.ws.close();
  });

});
