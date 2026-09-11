import koffi from "koffi";

type MediaPermissionStatus =
  "not-determined" | "granted" | "denied" | "restricted" | "unknown";

type TccApi = {
  createString: (alloc: null, str: string, encoding: number) => unknown;
  release: (ref: unknown) => void;
  preflight: (service: unknown, options: null) => number;
};

const kCFStringEncodingUTF8 = 0x08000100;
const AUDIO_CAPTURE_SERVICE = "kTCCServiceAudioCapture";

let tccApi: TccApi | null | undefined;

function loadTccApi(): TccApi | null {
  if (tccApi !== undefined) return tccApi;
  if (process.platform !== "darwin") {
    tccApi = null;
    return tccApi;
  }

  try {
    const coreFoundation = koffi.load(
      "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation",
    );
    const tcc = koffi.load(
      "/System/Library/PrivateFrameworks/TCC.framework/Versions/A/TCC",
    );
    tccApi = {
      createString: coreFoundation.func(
        "void *CFStringCreateWithCString(void *alloc, const char *cStr, uint32_t encoding)",
      ),
      release: coreFoundation.func("void CFRelease(void *cf)"),
      preflight: tcc.func(
        "int TCCAccessPreflight(void *service, void *options)",
      ),
    };
  } catch (error) {
    console.error("无法加载系统录音权限检查:", error);
    tccApi = null;
  }

  return tccApi;
}

export function getAudioCapturePermissionStatus(): MediaPermissionStatus {
  const api = loadTccApi();
  if (!api) return "unknown";

  const service = api.createString(
    null,
    AUDIO_CAPTURE_SERVICE,
    kCFStringEncodingUTF8,
  );
  if (!service) return "unknown";

  try {
    const result = api.preflight(service, null);
    if (result === 0) return "granted";
    if (result === 1) return "denied";
    return "not-determined";
  } catch (error) {
    console.error("检查系统录音权限失败:", error);
    return "unknown";
  } finally {
    api.release(service);
  }
}

export function isAudioCaptureDecided(status: MediaPermissionStatus) {
  return status === "granted" || status === "denied" || status === "restricted";
}
