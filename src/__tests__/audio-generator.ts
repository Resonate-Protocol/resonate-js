export interface AudioChunkConfig {
  durationSec: number;
  sampleRate: number;
  channels: number;
  bitDepth: number;
  frequency?: number;
}

export function generatePCMAudioChunk(config: AudioChunkConfig): ArrayBuffer {
  const { durationSec, sampleRate, channels, bitDepth, frequency = 440 } = config;
  const numSamples = Math.floor(durationSec * sampleRate);
  const bytesPerSample = bitDepth / 8;
  const buffer = new ArrayBuffer(numSamples * channels * bytesPerSample);
  const view = new DataView(buffer);

  let offset = 0;
  for (let i = 0; i < numSamples; i++) {
    const sample = 0.3 * Math.sin((2 * Math.PI * frequency * i) / sampleRate);

    for (let ch = 0; ch < channels; ch++) {
      if (bitDepth === 16) {
        view.setInt16(offset, Math.floor(sample * 32767), true);
        offset += 2;
      } else if (bitDepth === 24) {
        const intSample = Math.floor(sample * 8388607);
        view.setUint8(offset, intSample & 0xff);
        view.setUint8(offset + 1, (intSample >> 8) & 0xff);
        view.setUint8(offset + 2, (intSample >> 16) & 0xff);
        offset += 3;
      } else if (bitDepth === 32) {
        view.setInt32(offset, Math.floor(sample * 2147483647), true);
        offset += 4;
      }
    }
  }

  return buffer;
}

export function generateSilentChunk(config: AudioChunkConfig): ArrayBuffer {
  const { durationSec, sampleRate, channels, bitDepth } = config;
  const numSamples = Math.floor(durationSec * sampleRate);
  return new ArrayBuffer(numSamples * channels * (bitDepth / 8));
}

export function calculateChunkDurationUs(
  numBytes: number,
  sampleRate: number,
  channels: number,
  bitDepth: number,
): number {
  const numSamples = numBytes / (channels * (bitDepth / 8));
  return Math.floor((numSamples / sampleRate) * 1_000_000);
}

export function generateChunkSequence(
  startTimeUs: number,
  chunkCount: number,
  config: AudioChunkConfig,
): Array<{ audioData: ArrayBuffer; serverTimeUs: number }> {
  const chunkBytes =
    Math.floor(config.durationSec * config.sampleRate) * config.channels * (config.bitDepth / 8);
  const chunkDurationUs = calculateChunkDurationUs(
    chunkBytes,
    config.sampleRate,
    config.channels,
    config.bitDepth,
  );

  const chunks: Array<{ audioData: ArrayBuffer; serverTimeUs: number }> = [];
  let currentTimeUs = startTimeUs;

  for (let i = 0; i < chunkCount; i++) {
    chunks.push({
      audioData: generatePCMAudioChunk({
        ...config,
        frequency: (config.frequency ?? 440) + i * 10,
      }),
      serverTimeUs: currentTimeUs,
    });
    currentTimeUs += chunkDurationUs;
  }

  return chunks;
}
