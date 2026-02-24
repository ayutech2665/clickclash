// Audio level utilities for speaking detection via Web Audio API AnalyserNode.

/** Create an AnalyserNode connected to a MediaStream's audio. */
export function createAnalyser(stream: MediaStream, audioCtx: AudioContext): AnalyserNode {
  const source = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  return analyser;
}

/**
 * Compute root-mean-square (RMS) of the current audio frame.
 * Returns a value between 0 (silence) and 1 (full volume).
 */
export function computeRMS(analyser: AnalyserNode): number {
  const data = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteTimeDomainData(data);
  let sum = 0;
  for (const v of data) {
    const normalized = (v - 128) / 128; // center around 0
    sum += normalized * normalized;
  }
  return Math.sqrt(sum / data.length);
}

/** RMS threshold above which we consider the audio source to be speaking. */
export const SPEAKING_THRESHOLD = 0.012;

export function isSpeakingNow(analyser: AnalyserNode): boolean {
  return computeRMS(analyser) > SPEAKING_THRESHOLD;
}
