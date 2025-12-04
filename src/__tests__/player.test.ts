import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SendspinPlayer } from "../index";
import { MockSendspinServer } from "./mock-server";
import { generateChunkSequence } from "./audio-generator";
import {
  setupTestEnvironment,
  createPlayer,
  connectPlayer,
  connectAndSync,
  startStream,
  sendChunks,
  sendChunksOutOfOrder,
  getScheduledStartTimes,
  delay,
  DEFAULT_STREAM_FORMAT,
  DEFAULT_CHUNK_CONFIG,
  Timing,
  type AudioContextSpy,
} from "./test-helpers";

describe("SendspinPlayer E2E", () => {
  let server: MockSendspinServer;
  let player: SendspinPlayer;
  let audioSpy: AudioContextSpy;

  beforeEach(() => {
    const env = setupTestEnvironment();
    server = env.server;
    audioSpy = env.audioSpy;
  });

  afterEach(() => {
    player?.disconnect();
    server.close();
    vi.restoreAllMocks();
  });

  describe("Connection and Handshake", () => {
    it("should connect and complete handshake", async () => {
      player = createPlayer({ clientName: "Test Player" });
      await connectPlayer(player, server);

      const hello = server.getLastMessage("client/hello");
      expect(hello.payload.client_id).toBe("test-player-1");
      expect(hello.payload.name).toBe("Test Player");

      await server.waitForMessage("client/state", Timing.MESSAGE_WAIT);
      expect(server.getLastMessage("client/state")).toBeDefined();
    });

    it("should report connection status", async () => {
      player = createPlayer();
      expect(player.isConnected).toBe(false);

      await player.connect();
      await delay(Timing.PROCESSING);

      expect(player.isConnected).toBe(true);
    });
  });

  describe("Time Synchronization", () => {
    it("should establish time sync with server", async () => {
      player = createPlayer();
      await connectAndSync(player, server);

      const syncInfo = player.timeSyncInfo;
      expect(syncInfo.synced).toBe(true);
      expect(Math.abs(syncInfo.offset - 5)).toBeLessThan(10); // ~5ms offset configured
    });
  });

  describe("Audio Streaming", () => {
    it("should schedule audio chunks at correct times", async () => {
      player = createPlayer();
      await connectAndSync(player, server);
      await startStream(server);

      expect(player.isPlaying).toBe(true);

      sendChunks(server, 3);
      await delay(Timing.QUEUE_DEBOUNCE + Timing.PROCESSING);

      expect(audioSpy.sources.length).toBe(3);

      const times = getScheduledStartTimes(audioSpy);
      expect(times[1]).toBeGreaterThan(times[0]);
      expect(times[2]).toBeGreaterThan(times[1]);

      // Chunks should be ~100ms apart
      expect(Math.abs(times[1] - times[0] - 0.1)).toBeLessThan(0.01);
      expect(Math.abs(times[2] - times[1] - 0.1)).toBeLessThan(0.01);
    });

    it("should handle out-of-order chunk arrival", async () => {
      player = createPlayer();
      await connectAndSync(player, server);
      await startStream(server);

      const chunks = generateChunkSequence(
        server.getServerTime() + 500_000,
        3,
        DEFAULT_CHUNK_CONFIG,
      );

      // Send in order: 2, 0, 1
      await sendChunksOutOfOrder(server, chunks, [2, 0, 1]);
      await delay(Timing.QUEUE_DEBOUNCE);

      expect(audioSpy.sources.length).toBe(3);

      const times = getScheduledStartTimes(audioSpy);
      expect(times[0]).toBeLessThan(times[1]);
      expect(times[1]).toBeLessThan(times[2]);
    });

    it("should drop late-arriving chunks", async () => {
      player = createPlayer();
      await connectAndSync(player, server);
      await startStream(server);

      // Send chunk with timestamp 1 second in the past
      const pastChunks = generateChunkSequence(
        server.getServerTime() - 1_000_000,
        1,
        DEFAULT_CHUNK_CONFIG,
      );
      server.sendAudioChunk(pastChunks[0].serverTimeUs, pastChunks[0].audioData);
      await delay(Timing.QUEUE_DEBOUNCE);

      expect(audioSpy.sources.length).toBe(0);
    });

    it("should resync on large drift errors", async () => {
      player = createPlayer();
      await connectAndSync(player, server);
      await startStream(server);

      const chunks = sendChunks(server, 1);
      await delay(Timing.QUEUE_DEBOUNCE);

      expect(audioSpy.sources.length).toBe(1);
      const initialResyncCount = player.syncInfo.resyncCount;

      await delay(100);

      // Send second chunk with a gap > 20ms sync error threshold
      const chunk2 = generateChunkSequence(
        chunks[0].serverTimeUs + 200_000, // 200ms later
        1,
        DEFAULT_CHUNK_CONFIG,
      );
      server.sendAudioChunk(chunk2[0].serverTimeUs, chunk2[0].audioData);
      await delay(Timing.QUEUE_DEBOUNCE);

      expect(audioSpy.sources.length).toBe(2);
      expect(player.syncInfo.resyncCount).toBeGreaterThan(initialResyncCount);
    });

    it("should clear buffers on stream clear (seek)", async () => {
      player = createPlayer();
      await connectAndSync(player, server);
      await startStream(server);

      sendChunks(server, 2);
      await delay(Timing.QUEUE_DEBOUNCE);

      expect(audioSpy.sources.length).toBe(2);
      audioSpy.sources.forEach((s) => expect(s.start).toHaveBeenCalled());

      server.sendStreamClear();
      await delay(Timing.PROCESSING);

      expect(player.isPlaying).toBe(true);

      sendChunks(server, 2);
      await delay(Timing.QUEUE_DEBOUNCE);

      expect(audioSpy.sources.length).toBeGreaterThan(2);
    });

    it("should stop playback on stream end", async () => {
      player = createPlayer();
      await connectPlayer(player, server);

      await startStream(server);
      expect(player.isPlaying).toBe(true);
      expect(player.currentFormat).toEqual(DEFAULT_STREAM_FORMAT);

      server.sendStreamEnd();
      await delay(Timing.PROCESSING);

      expect(player.isPlaying).toBe(false);
      expect(player.currentFormat).toBe(null);

      const state = server.getLastMessage("client/state");
      expect(state.payload.player.state).toBe("synchronized");
    });
  });

  describe("Volume Control", () => {
    it("should handle volume commands from server", async () => {
      player = createPlayer();
      await connectPlayer(player, server);

      expect(player.volume).toBe(100);

      server.sendVolumeCommand(50);
      await delay(Timing.PROCESSING);

      expect(player.volume).toBe(50);
      expect(server.getLastMessage("client/state").payload.player.volume).toBe(50);
    });

    it("should handle mute commands from server", async () => {
      player = createPlayer();
      await connectPlayer(player, server);

      expect(player.muted).toBe(false);

      server.sendMuteCommand(true);
      await delay(Timing.PROCESSING);
      expect(player.muted).toBe(true);

      server.sendMuteCommand(false);
      await delay(Timing.PROCESSING);
      expect(player.muted).toBe(false);
    });

    it("should allow client to set volume", async () => {
      player = createPlayer();
      await connectPlayer(player, server);

      player.setVolume(75);
      expect(player.volume).toBe(75);

      await delay(Timing.PROCESSING);
      expect(server.getLastMessage("client/state").payload.player.volume).toBe(75);
    });

    it("should allow client to set muted state", async () => {
      player = createPlayer();
      await connectPlayer(player, server);

      player.setMuted(true);
      expect(player.muted).toBe(true);

      await delay(Timing.PROCESSING);
      expect(server.getLastMessage("client/state").payload.player.muted).toBe(true);
    });
  });

  describe("Sync Delay", () => {
    it("should allow runtime sync delay adjustment", async () => {
      player = createPlayer({ syncDelay: 50 });
      await connectAndSync(player, server);
      await startStream(server);

      const chunks = sendChunks(server, 1);
      await delay(Timing.QUEUE_DEBOUNCE);

      const firstScheduleTime = audioSpy.sources[0].start.mock.calls[0][0];

      player.setSyncDelay(100);

      const chunk2 = generateChunkSequence(
        chunks[0].serverTimeUs + 100_000,
        1,
        DEFAULT_CHUNK_CONFIG,
      );
      server.sendAudioChunk(chunk2[0].serverTimeUs, chunk2[0].audioData);
      await delay(Timing.QUEUE_DEBOUNCE);

      expect(audioSpy.sources.length).toBe(2);
    });
  });
});
