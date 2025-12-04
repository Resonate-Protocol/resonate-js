# Sendspin E2E Tests

End-to-end tests for the Sendspin audio streaming player.

## What These Tests Verify

**Things these tests catch:**
- Scheduling errors (chunks scheduled at wrong times)
- Out-of-order playback issues
- Dropped chunks that should/shouldn't be dropped
- Resync failures on large drift
- Buffer management on seek
- Time synchronization establishment
- Volume/mute commands

**Things these tests cannot catch:**
- Actual audio quality (clicks, pops, distortion)
- Browser-specific codec behavior
- Real Web Audio timing precision
- Real network conditions (jitter, packet loss)

## Architecture

### `mock-server.ts`
Mock WebSocket server that implements the Sendspin protocol. Simulates configurable clock offset and network latency.

### `audio-generator.ts`
Generates synthetic PCM audio (sine waves) for testing.

### `test-helpers.ts`
Shared utilities: test setup, player creation, timing constants, and assertion helpers.

### `player.test.ts`
The test suite itself. Tests connection, time sync, audio streaming, volume control, and sync delay.

## Running Tests

```bash
npm test          # Run all tests
npm run test:watch # Watch mode
npm run test:ui    # UI mode
```

## Test Timing

Tests use real time (not mocked) because time synchronization requires actual setTimeout/setInterval behavior. Tests that wait for time sync take ~5 seconds each.
