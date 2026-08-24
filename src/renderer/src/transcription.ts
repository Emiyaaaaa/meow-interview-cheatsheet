const ASR_URL =
  "wss://gw-da1qng6m1hkl4art9m8g-tobkhiex7vkv0kcpjc-cn-hangzhou.alicloudapi.com/api-ws/v1/inference";
const TARGET_SAMPLE_RATE = 16_000;

interface TranscriptionCallbacks {
  onError: (message: string) => void;
  onResult: (text: string, isFinal: boolean) => void;
}

interface AsrMessage {
  header?: {
    event?: string;
    error_message?: string;
  };
  payload?: {
    output?: {
      sentence?: {
        sentence_end?: boolean;
        text?: string;
      };
    };
  };
}

function createTaskId() {
  return crypto.randomUUID().replaceAll("-", "");
}

function downsampleToPcm16(input: Float32Array, inputSampleRate: number) {
  const ratio = inputSampleRate / TARGET_SAMPLE_RATE;
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
  private audioContext: AudioContext | null = null;
  private callbacks: TranscriptionCallbacks;
  private mediaStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private socket: WebSocket | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private taskId = "";
  private taskStarted = false;
  private unsubscribeCoreAudioData: (() => void) | null = null;
  private unsubscribeCoreAudioError: (() => void) | null = null;
  private usingCoreAudio = false;
  private userStopping = false;

  constructor(callbacks: TranscriptionCallbacks) {
    this.callbacks = callbacks;
  }

  async start(
    captureMode: SystemAudioCaptureMode = "loopback",
    source: AudioCaptureSource = "system-audio",
  ) {
    if (this.socket) return;

    this.userStopping = false;
    this.taskStarted = false;
    this.taskId = createTaskId();

    try {
      if (source === "microphone") {
        this.mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        await this.openSocket();
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
            if (
              this.socket?.readyState === WebSocket.OPEN &&
              this.taskStarted
            ) {
              this.socket.send(data);
            }
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
          throw new Error(
            "未获取到系统音频，请在系统设置中允许录制系统音频",
          );
        }
      }

      await this.openSocket();
      if (!this.usingCoreAudio) {
        await this.startAudioPipeline();
      }
    } catch (error) {
      this.cleanup();
      throw error;
    }
  }

  stop() {
    if (!this.socket && !this.mediaStream) return;

    this.userStopping = true;
    this.stopAudioPipeline();

    if (
      this.socket?.readyState === WebSocket.OPEN &&
      this.taskStarted
    ) {
      this.socket.send(
        JSON.stringify({
          header: {
            action: "finish-task",
            task_id: this.taskId,
            streaming: "duplex",
          },
          payload: { input: {} },
        }),
      );

      window.setTimeout(() => this.cleanup(), 2_000);
      return;
    }

    this.cleanup();
  }

  private openSocket() {
    return new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(ASR_URL);
      this.socket = socket;

      socket.addEventListener("open", () => {
        socket.send(
          JSON.stringify({
            header: {
              action: "run-task",
              task_id: this.taskId,
              streaming: "duplex",
            },
            payload: {
              task_group: "audio",
              task: "asr",
              function: "recognition",
              model: "fun-asr-realtime",
              parameters: {
                format: "pcm",
                sample_rate: TARGET_SAMPLE_RATE,
              },
              input: {},
            },
          }),
        );
      });

      socket.addEventListener("message", (event) => {
        void this.handleMessage(event.data, resolve, reject);
      });

      socket.addEventListener("error", () => {
        const error = new Error("语音识别服务连接失败");
        if (!this.taskStarted) reject(error);
        this.callbacks.onError(error.message);
      });

      socket.addEventListener("close", () => {
        const stoppedNormally = this.userStopping;
        this.cleanup();
        if (!stoppedNormally && this.taskStarted) {
          this.callbacks.onError("语音识别连接已断开");
        }
      });
    });
  }

  private async handleMessage(
    data: unknown,
    resolve: () => void,
    reject: (reason: Error) => void,
  ) {
    try {
      const raw =
        typeof data === "string"
          ? data
          : data instanceof Blob
            ? await data.text()
            : "";
      const message = JSON.parse(raw) as AsrMessage;
      const event = message.header?.event;

      if (event === "task-started") {
        this.taskStarted = true;
        resolve();
        return;
      }

      if (event === "result-generated") {
        const sentence = message.payload?.output?.sentence;
        const text = sentence?.text?.trim();
        if (text) {
          this.callbacks.onResult(text, sentence?.sentence_end === true);
        }
        return;
      }

      if (event === "task-finished") {
        this.cleanup();
        return;
      }

      if (event === "task-failed") {
        const error = new Error(
          message.header?.error_message || "语音识别任务失败",
        );
        if (!this.taskStarted) reject(error);
        this.callbacks.onError(error.message);
        this.cleanup();
      }
    } catch {
      this.callbacks.onError("无法解析语音识别服务返回的数据");
    }
  }

  private async startAudioPipeline() {
    if (!this.mediaStream) return;

    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(this.mediaStream);
    const processor = audioContext.createScriptProcessor(4_096, 1, 1);
    const mutedOutput = audioContext.createGain();
    mutedOutput.gain.value = 0;

    processor.addEventListener("audioprocess", (event) => {
      if (
        this.socket?.readyState !== WebSocket.OPEN ||
        !this.taskStarted
      ) {
        return;
      }

      const samples = event.inputBuffer.getChannelData(0);
      this.socket.send(downsampleToPcm16(samples, audioContext.sampleRate));
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
    if (this.socket) {
      this.socket.onclose = null;
      this.socket.close();
      this.socket = null;
    }
    this.taskStarted = false;
  }
}
