import { useEffect, useRef, useState } from "react";
import { Button, Modal, ProgressBar } from "@heroui/react";
import { CircleArrowUp, CircleCheck, Pause } from "lucide-react";

const MANUAL_STALL_MS = 5_000;

function formatVersion(version: string) {
  const value = version.trim();
  if (!value) return "";
  return value.startsWith("V") || value.startsWith("v") ? value : `V${value}`;
}

function ManualDownloadLinks({
  githubUrl,
  qiniuUrl,
}: {
  githubUrl: string;
  qiniuUrl: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted">若未自动下载请点击下方链接手动下载</p>
      <button
        className="cursor-pointer text-left text-sm font-medium text-brand underline-offset-2 hover:underline"
        type="button"
        onClick={() => void window.desktop.openExternal(qiniuUrl)}
      >
        国内下载连接（七牛云）
      </button>
      <button
        className="cursor-pointer text-left text-sm font-medium text-brand underline-offset-2 hover:underline"
        type="button"
        onClick={() => void window.desktop.openExternal(githubUrl)}
      >
        海外下载链接（github）
      </button>
    </div>
  );
}

export function UpdateEntry() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [open, setOpen] = useState(false);
  const [dialogKind, setDialogKind] = useState<"timeout" | "error" | null>(
    null,
  );
  const [awaitingProgress, setAwaitingProgress] = useState(false);
  const [paused, setPaused] = useState(false);
  const pauseIntentRef = useRef(false);
  const [state, setState] = useState<UpdateState>({
    percent: 0,
    received: 0,
    status: "idle",
    total: 0,
  });

  useEffect(() => {
    const offState = window.desktop.onUpdateState((next) => {
      setState(next);
      if (next.status === "paused") {
        pauseIntentRef.current = false;
        setPaused(true);
        setAwaitingProgress(false);
      } else if (next.status === "downloading") {
        if (!pauseIntentRef.current) setPaused(false);
        if (next.received > 0) setAwaitingProgress(false);
      } else if (next.received > 0) {
        setAwaitingProgress(false);
      }
      if (next.status === "ready") {
        pauseIntentRef.current = false;
        setPaused(false);
        setAwaitingProgress(false);
        setOpen(false);
        setDialogKind(null);
      }
      if (next.status === "error") {
        pauseIntentRef.current = false;
        setPaused(false);
        setAwaitingProgress(false);
        setDialogKind("error");
        setOpen(true);
      }
    });

    void window.desktop
      .checkForUpdates()
      .then((result) => {
        setInfo(result);
        if (!result.alreadyDownloaded) return;
        setState((prev) =>
          prev.status === "ready"
            ? prev
            : { percent: 100, received: 0, status: "ready", total: 0 },
        );
      })
      .catch(() => undefined);

    return offState;
  }, []);

  useEffect(() => {
    const downloading =
      !paused && (awaitingProgress || state.status === "downloading");
    if (!downloading || state.received > 0) return;
    if (state.status === "ready" || state.status === "error" || paused) return;
    const timer = window.setTimeout(() => {
      setDialogKind("timeout");
      setOpen(true);
    }, MANUAL_STALL_MS);
    return () => window.clearTimeout(timer);
  }, [awaitingProgress, paused, state.received, state.status]);

  if (!info?.hasUpdate) return null;

  const versionLabel = formatVersion(info.latestVersion);
  const unknownSize = state.total <= 0 && state.received > 0;
  const downloading =
    !paused && (awaitingProgress || state.status === "downloading");
  const ready = state.status === "ready";
  const percentLabel = `${Math.round(state.percent)}%`;

  function startDownload() {
    pauseIntentRef.current = false;
    setPaused(false);
    setDialogKind(null);
    setOpen(false);
    setAwaitingProgress(true);
    void window.desktop.startUpdateDownload().catch(() => undefined);
  }

  function pauseDownload() {
    pauseIntentRef.current = true;
    setPaused(true);
    setAwaitingProgress(false);
    void window.desktop.pauseUpdateDownload().catch(() => {
      pauseIntentRef.current = false;
      setPaused(false);
    });
  }

  function handleAction() {
    if (ready) {
      void window.desktop.installUpdate().catch((error) => {
        setDialogKind("error");
        setState((prev) => ({
          ...prev,
          message:
            error instanceof Error ? error.message : "安装失败，请手动下载",
          status: "error",
        }));
        setOpen(true);
      });
      return;
    }
    if (downloading) {
      pauseDownload();
      return;
    }
    startDownload();
  }

  return (
    <>
      <div className="flex h-7 w-full translate-y-3 items-center rounded-full p-1">
        <div className="flex min-w-0 flex-1 items-center pr-2.5">
          {downloading && !ready ? (
            <ProgressBar
              aria-label="下载进度"
              className="w-full gap-0"
              color="success"
              isIndeterminate={unknownSize}
              value={Math.round(state.percent)}
            >
              <ProgressBar.Track className="h-1.5 rounded-full bg-black/15">
                <ProgressBar.Fill className="rounded-full bg-brand" />
              </ProgressBar.Track>
            </ProgressBar>
          ) : (
            <span className="flex min-w-0 items-center gap-1 text-xs text-black/55">
              {ready ? (
                <CircleCheck
                  aria-hidden
                  className="size-3.5 shrink-0 text-brand"
                />
              ) : (
                <CircleArrowUp
                  aria-hidden
                  className="size-3.5 shrink-0 text-brand"
                />
              )}
              <span className="truncate">
                {ready
                  ? `${versionLabel} 下载完成`
                  : `发现新版本 ${versionLabel}`}
              </span>
            </span>
          )}
        </div>
        <button
          className="group inline-flex h-full min-w-14 shrink-0 items-center justify-center rounded-full bg-brand px-3 text-xs font-medium whitespace-nowrap text-white hover:bg-brand-hover"
          type="button"
          onClick={handleAction}
        >
          {ready ? (
            "安装"
          ) : paused ? (
            "继续下载"
          ) : downloading ? (
            <>
              <span className="group-hover:hidden">{percentLabel}</span>
              <Pause className="hidden size-3 group-hover:block" />
            </>
          ) : (
            "更新"
          )}
        </button>
      </div>

      <Modal.Backdrop isOpen={open} onOpenChange={setOpen}>
        <Modal.Container size="sm">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>
                {dialogKind === "timeout" ? "下载超时" : "更新失败"}
              </Modal.Heading>
            </Modal.Header>
            <Modal.Body className="flex flex-col gap-4">
              <p className="text-sm text-black">
                {dialogKind === "timeout"
                  ? "下载超时"
                  : state.message || "下载失败，请使用下方链接手动下载"}
              </p>
              <ManualDownloadLinks
                githubUrl={info.githubUrl}
                qiniuUrl={info.qiniuUrl}
              />
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" onPress={() => setOpen(false)}>
                关闭
              </Button>
              <Button
                className="bg-brand text-white hover:bg-brand-hover"
                onPress={startDownload}
              >
                重试下载
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </>
  );
}
