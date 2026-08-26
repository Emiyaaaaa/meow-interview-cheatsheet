import { AsrClient, ASR_SAMPLE_RATE, type AsrStartOptions } from "./services";

interface TranscriptionCallbacks {
  onError: (message: string) => void;
  onResult: (text: string, isFinal: boolean) => void;
}

function downsampleToPcm16(input: Float32Array, inputSampleRate: number) {
  const ratio = inputSampleRate / ASR_SAMPLE_RATE;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Int16Array(outputLength);

  for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
    const start = Math.floor(outputIndex * ratio);
    const end = Math.min(Math.floor((outputIndex + 1) * ratio), input.length);
    let total = 0;

    for (let inputIndex = start; inputIndex < end; inputIndex += 1) {
      total += input[inputIndex];
    }

    const sample = Math.max(-1, Math.min(1, total / Math.max(1, end - start)));
    output[outputIndex] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }

  return output.buffer;
}

export class SystemAudioTranscription {
  private asr: AsrClient;
  private audioContext: AudioContext | null = null;
  private callbacks: TranscriptionCallbacks;
  private mediaStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private unsubscribeCoreAudioData: (() => void) | null = null;
  private unsubscribeCoreAudioError: (() => void) | null = null;
  private usingCoreAudio = false;

  constructor(callbacks: TranscriptionCallbacks) {
    this.callbacks = callbacks;
    this.asr = new AsrClient({
      ...callbacks,
      onClose: () => this.stopAudioPipeline(),
    });
  }

  async start(
    captureMode: SystemAudioCaptureMode = "loopback",
    source: AudioCaptureSource = "system-audio",
    asrOptions?: AsrStartOptions,
  ) {
    if (this.asr.isConnected) return;

    try {
      if (source === "microphone") {
        this.mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        await this.asr.start(asrOptions);
        await this.startAudioPipeline();
        return;
      }

      if (captureMode === "unsupported") {
        throw new Error("当前 macOS 版本不支持免驱动系统音频采集");
      }

      if (captureMode === "core-audio") {
        this.usingCoreAudio = true;
        this.unsubscribeCoreAudioData = window.desktop.onSystemAudioData(
          (data) => {
            this.asr.sendAudio(data);
          },
        );
        this.unsubscribeCoreAudioError = window.desktop.onSystemAudioError(
          (message) => this.callbacks.onError(message),
        );
        await window.desktop.startCoreAudioCapture();
      } else {
        this.mediaStream = await navigator.mediaDevices.getDisplayMedia({
          audio: true,
          video: true,
        });

        for (const track of this.mediaStream.getVideoTracks()) {
          track.stop();
          this.mediaStream.removeTrack(track);
        }

        if (this.mediaStream.getAudioTracks().length === 0) {
          throw new Error("未获取到系统音频，请在系统设置中允许录制系统音频");
        }
      }

      await this.asr.start(asrOptions);
      if (!this.usingCoreAudio) {
        await this.startAudioPipeline();
      }
    } catch (error) {
      this.cleanup();
      throw error;
    }
  }

  stop() {
    if (!this.asr.isConnected && !this.mediaStream && !this.usingCoreAudio) {
      return;
    }

    this.stopAudioPipeline();
    this.asr.finish();
  }

  private async startAudioPipeline() {
    if (!this.mediaStream) return;

    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(this.mediaStream);
    const processor = audioContext.createScriptProcessor(4_096, 1, 1);
    const mutedOutput = audioContext.createGain();
    mutedOutput.gain.value = 0;

    processor.addEventListener("audioprocess", (event) => {
      const samples = event.inputBuffer.getChannelData(0);
      this.asr.sendAudio(downsampleToPcm16(samples, audioContext.sampleRate));
    });

    source.connect(processor);
    processor.connect(mutedOutput);
    mutedOutput.connect(audioContext.destination);

    this.audioContext = audioContext;
    this.source = source;
    this.processor = processor;
    await audioContext.resume();
  }

  private stopAudioPipeline() {
    this.unsubscribeCoreAudioData?.();
    this.unsubscribeCoreAudioError?.();
    this.unsubscribeCoreAudioData = null;
    this.unsubscribeCoreAudioError = null;
    if (this.usingCoreAudio) {
      this.usingCoreAudio = false;
      void window.desktop.stopCoreAudioCapture();
    }

    this.processor?.disconnect();
    this.source?.disconnect();
    this.processor = null;
    this.source = null;

    for (const track of this.mediaStream?.getTracks() ?? []) {
      track.stop();
    }
    this.mediaStream = null;

    if (this.audioContext) {
      void this.audioContext.close();
      this.audioContext = null;
    }
  }

  private cleanup() {
    this.stopAudioPipeline();
    this.asr.close();
  }
}
