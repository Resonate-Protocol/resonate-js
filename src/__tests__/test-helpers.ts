import { vi } from "vitest";
import { SendspinPlayer } from "../index";
import { MockSendspinServer } from "./mock-server";
import { generateChunkSequence } from "./audio-generator";
import type { StreamFormat } from "../types";

// ============================================================================
// Constants
// ============================================================================

export const DEFAULT_STREAM_FORMAT: StreamFormat = {
  codec: "pcm",
  sample_rate: 48000,
  channels: 2,
  bit_depth: 16,
};

export const DEFAULT_CHUNK_CONFIG = {
  durationSec: 0.1,
  sampleRate: 48000,
  channels: 2,
  bitDepth: 16,
} as const;

export const DEFAULT_SERVER_CONFIG = {
  clockOffsetUs: 5000, // 5ms server ahead
  networkLatencyMs: 10,
} as const;

export const Timing = {
  MESSAGE_WAIT: 500,
  PROCESSING: 50,
  QUEUE_DEBOUNCE: 150,
  CHUNK_STAGGER: 10,
  TIME_SYNC_POLL: 100,
  TIME_SYNC_TIMEOUT: 15000,
} as const;

// ============================================================================
// Types
// ============================================================================

export interface AudioSourceSpy {
  start: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  buffer: AudioBuffer | null;
  onended: (() => void) | null;
}

export interface AudioContextSpy {
  createBufferSource: ReturnType<typeof vi.fn>;
  sources: AudioSourceSpy[];
}

export interface TestContext {
  server: MockSendspinServer;
  player: SendspinPlayer;
  audioSpy: AudioContextSpy;
}

// ============================================================================
// AudioContext Mock
// ============================================================================

export function createMockAudioContext(spy: AudioContextSpy): typeof AudioContext {
  return class MockAudioContext {
    sampleRate = 48000;
    currentTime = 0;
    state = "running";
    destination = {};

    createGain() {
      return { gain: { value: 1 }, connect: vi.fn() };
    }

    createBufferSource() {
      const source: AudioSourceSpy = {
        buffer: null,
        start: vi.fn(),
        connect: vi.fn(),
        onended: null,
      };
      spy.sources.push(source);
      return source;
    }

    createBuffer(channels: number, length: number, sampleRate: number) {
      return {
        duration: length / sampleRate,
        length,
        numberOfChannels: channels,
        sampleRate,
        getChannelData: () => new Float32Array(length),
        copyFromChannel: vi.fn(),
        copyToChannel: vi.fn(),
      } as AudioBuffer;
    }

    createMediaStreamDestination() {
      return { stream: {}, connect: vi.fn() };
    }

    async resume() {}
    async close() {}

    decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer> {
      const numSamples = data.byteLength / 4; // 16-bit stereo
      return Promise.resolve(this.createBuffer(2, numSamples, 48000));
    }
  } as unknown as typeof AudioContext;
}

export function createAudioSpy(): AudioContextSpy {
  const sources: AudioSourceSpy[] = [];
  return {
    createBufferSource: vi.fn(),
    sources,
  };
}

// ============================================================================
// Test Setup Helpers
// ============================================================================

export function setupTestEnvironment(
  serverConfig = DEFAULT_SERVER_CONFIG,
): { server: MockSendspinServer; audioSpy: AudioContextSpy } {
  const server = new MockSendspinServer(serverConfig);
  server.install();

  const audioSpy = createAudioSpy();
  (globalThis as any).AudioContext = createMockAudioContext(audioSpy);

  return { server, audioSpy };
}

export function createPlayer(options: Partial<{
  playerId: string;
  baseUrl: string;
  clientName: string;
  syncDelay: number;
}> = {}): SendspinPlayer {
  return new SendspinPlayer({
    playerId: options.playerId ?? "test-player-1",
    baseUrl: options.baseUrl ?? "http://localhost:8095",
    clientName: options.clientName,
    syncDelay: options.syncDelay,
  });
}

export async function connectPlayer(
  player: SendspinPlayer,
  server: MockSendspinServer,
): Promise<void> {
  await player.connect();
  await server.waitForMessage("client/hello", Timing.MESSAGE_WAIT);
}

export async function connectAndSync(
  player: SendspinPlayer,
  server: MockSendspinServer,
): Promise<void> {
  await connectPlayer(player, server);
  await waitForTimeSync(player);
}

// ============================================================================
// Time Sync
// ============================================================================

export async function waitForTimeSync(player: SendspinPlayer): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < Timing.TIME_SYNC_TIMEOUT) {
    if (player.timeSyncInfo.synced) return;
    await delay(Timing.TIME_SYNC_POLL);
  }

  throw new Error(`Time sync not established after ${Timing.TIME_SYNC_TIMEOUT}ms`);
}

// ============================================================================
// Streaming Helpers
// ============================================================================

export async function startStream(
  server: MockSendspinServer,
  format = DEFAULT_STREAM_FORMAT,
): Promise<void> {
  server.sendStreamStart(format);
  await delay(Timing.PROCESSING);
}

export function sendChunks(
  server: MockSendspinServer,
  count: number,
  options: {
    startTimeUs?: number;
    futureOffsetUs?: number;
    config?: typeof DEFAULT_CHUNK_CONFIG;
  } = {},
): ReturnType<typeof generateChunkSequence> {
  const startTimeUs = options.startTimeUs
    ?? server.getServerTime() + (options.futureOffsetUs ?? 500_000);
  const chunks = generateChunkSequence(startTimeUs, count, options.config ?? DEFAULT_CHUNK_CONFIG);

  for (const chunk of chunks) {
    server.sendAudioChunk(chunk.serverTimeUs, chunk.audioData);
  }

  return chunks;
}

export async function sendChunksOutOfOrder(
  server: MockSendspinServer,
  chunks: ReturnType<typeof generateChunkSequence>,
  order: number[],
): Promise<void> {
  for (const index of order) {
    server.sendAudioChunk(chunks[index].serverTimeUs, chunks[index].audioData);
    await delay(Timing.CHUNK_STAGGER);
  }
}

// ============================================================================
// Assertions
// ============================================================================

export function getScheduledStartTimes(spy: AudioContextSpy): number[] {
  return spy.sources.map((s) => s.start.mock.calls[0]?.[0]);
}

export function assertChunksInOrder(spy: AudioContextSpy): void {
  const times = getScheduledStartTimes(spy);
  for (let i = 1; i < times.length; i++) {
    if (times[i] <= times[i - 1]) {
      throw new Error(`Chunk ${i} scheduled at ${times[i]} but chunk ${i - 1} at ${times[i - 1]}`);
    }
  }
}

export function assertChunkGaps(
  spy: AudioContextSpy,
  expectedGap: number,
  tolerance: number,
): void {
  const times = getScheduledStartTimes(spy);
  for (let i = 1; i < times.length; i++) {
    const gap = times[i] - times[i - 1];
    if (Math.abs(gap - expectedGap) >= tolerance) {
      throw new Error(`Gap between chunks ${i - 1} and ${i} was ${gap}, expected ~${expectedGap}`);
    }
  }
}

// ============================================================================
// Utilities
// ============================================================================

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
