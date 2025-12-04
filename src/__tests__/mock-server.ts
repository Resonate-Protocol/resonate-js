import type { ClientHello, ClientTime, StreamFormat } from "../types";

export interface MockServerConfig {
  clockOffsetUs?: number;
  networkLatencyMs?: number;
}

export class MockSendspinServer {
  private ws: WebSocket | null = null;
  private clockOffsetUs: number;
  private networkLatencyMs: number;
  private messageHandlers: Array<(data: MessageEvent) => void> = [];
  private receivedMessages: any[] = [];

  constructor(config: MockServerConfig = {}) {
    this.clockOffsetUs = config.clockOffsetUs ?? 0;
    this.networkLatencyMs = config.networkLatencyMs ?? 10;
  }

  install(): void {
    const self = this;

    class MockWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;

      readyState = 0;
      url: string;

      private openHandler: (() => void) | null = null;
      private messageHandler: ((event: MessageEvent) => void) | null = null;
      private closeHandler: (() => void) | null = null;
      private errorHandler: ((event: Event) => void) | null = null;

      constructor(url: string) {
        this.url = url;
        self.ws = this as any;
        setTimeout(() => {
          this.readyState = 1;
          this.openHandler?.();
        }, 0);
      }

      send(data: string | ArrayBuffer) {
        if (typeof data === "string") {
          const message = JSON.parse(data);
          self.receivedMessages.push(message);
          self.handleClientMessage(message);
        }
      }

      close() {
        this.readyState = 3;
        this.closeHandler?.();
      }

      set onopen(handler: () => void) {
        this.openHandler = handler;
      }
      set onmessage(handler: (event: MessageEvent) => void) {
        this.messageHandler = handler;
        self.messageHandlers.push(handler);
      }
      set onclose(handler: () => void) {
        this.closeHandler = handler;
      }
      set onerror(handler: (event: Event) => void) {
        this.errorHandler = handler;
      }
    }

    (globalThis as any).WebSocket = MockWebSocket;
  }

  private handleClientMessage(message: any): void {
    switch (message.type) {
      case "client/hello":
        this.handleClientHello();
        break;
      case "client/time":
        this.handleClientTime(message as ClientTime);
        break;
    }
  }

  private handleClientHello(): void {
    setTimeout(() => {
      this.sendJSON({ type: "server/hello", payload: {} });
    }, this.networkLatencyMs);
  }

  private handleClientTime(message: ClientTime): void {
    const clientTransmitted = message.payload.client_transmitted;
    const now = performance.now() * 1000;
    const serverReceived = now + this.clockOffsetUs + this.networkLatencyMs * 1000;
    const serverTransmitted = serverReceived + 1000;

    setTimeout(() => {
      this.sendJSON({
        type: "server/time",
        payload: { client_transmitted: clientTransmitted, server_received: serverReceived, server_transmitted: serverTransmitted },
      });
    }, this.networkLatencyMs * 2);
  }

  private sendJSON(message: any): void {
    const event = new MessageEvent("message", { data: JSON.stringify(message) });
    this.messageHandlers.forEach((h) => h(event));
  }

  private sendBinary(buffer: ArrayBuffer): void {
    setTimeout(() => {
      const event = new MessageEvent("message", { data: buffer });
      this.messageHandlers.forEach((h) => h(event));
    }, this.networkLatencyMs);
  }

  sendAudioChunk(serverTimeUs: number, audioData: ArrayBuffer): void {
    const buffer = new ArrayBuffer(1 + 8 + audioData.byteLength);
    const view = new DataView(buffer);

    view.setUint8(0, 4); // Player audio chunk type
    view.setBigInt64(1, BigInt(Math.floor(serverTimeUs)), false);
    new Uint8Array(buffer, 9).set(new Uint8Array(audioData));

    this.sendBinary(buffer);
  }

  sendStreamStart(format: StreamFormat): void {
    this.sendJSON({ type: "stream/start", payload: { player: format } });
  }

  sendStreamEnd(): void {
    this.sendJSON({ type: "stream/end", payload: { roles: ["player"] } });
  }

  sendStreamClear(): void {
    this.sendJSON({ type: "stream/clear", payload: { roles: ["player"] } });
  }

  sendVolumeCommand(volume: number): void {
    this.sendJSON({
      type: "server/command",
      payload: { player: { command: "volume", volume } },
    });
  }

  sendMuteCommand(muted: boolean): void {
    this.sendJSON({
      type: "server/command",
      payload: { player: { command: "mute", mute: muted } },
    });
  }

  getReceivedMessages(): any[] {
    return this.receivedMessages;
  }

  getLastMessage(type: string): any | null {
    for (let i = this.receivedMessages.length - 1; i >= 0; i--) {
      if (this.receivedMessages[i].type === type) {
        return this.receivedMessages[i];
      }
    }
    return null;
  }

  async waitForMessage(type: string, timeoutMs = 1000): Promise<any> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      const message = this.getLastMessage(type);
      if (message) return message;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`Timeout waiting for message type: ${type}`);
  }

  getServerTime(): number {
    return performance.now() * 1000 + this.clockOffsetUs;
  }

  close(): void {
    (this.ws as any)?.close();
  }
}
