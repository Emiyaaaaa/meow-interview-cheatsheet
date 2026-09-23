import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Card,
  Chip,
  Description,
  Input,
  Label,
  Modal,
  Spinner,
  TextField,
  toast,
  useOverlayState,
} from "@heroui/react";
import { FolderOpen, RefreshCw } from "lucide-react";
import {
  fetchInterviewRecord,
  fetchInterviewRecords,
  pickInterviewRecordsDir,
  type InterviewRecord,
  type InterviewRecordSummary,
} from "../services/interview-records";

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function formatDateTime(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

function formatDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}小时${minutes}分${seconds}秒`;
  }
  if (minutes > 0) {
    return `${minutes}分${seconds}秒`;
  }
  return `${seconds}秒`;
}

function modeLabel(mode: InterviewRecordSummary["mode"]) {
  return mode === "mock" ? "模拟面试" : "正式面试";
}

function OverallEvaluationCard({
  evaluation,
}: {
  evaluation: NonNullable<InterviewRecord["overallEvaluation"]>;
}) {
  return (
    <Card
      className="border border-black/6 bg-[#f8f8f8] shadow-none"
      variant="secondary"
    >
      <Card.Header className="gap-1">
        <Card.Title className="text-sm">面试总评</Card.Title>
      </Card.Header>
      <Card.Content className="border-t border-black/6 pt-3">
        {evaluation.status === "error" ? (
          <p className="text-sm text-red-600">
            {evaluation.error ?? "总评生成失败"}
          </p>
        ) : (
          <div className="flex flex-col gap-2 text-sm leading-7">
            {evaluation.score != null ? (
              <p>
                <span className="text-muted">评分 </span>
                <span className="font-medium">{evaluation.score} / 10</span>
              </p>
            ) : null}
            {evaluation.summary ? (
              <p>
                <span className="text-muted">总评 </span>
                {evaluation.summary}
              </p>
            ) : null}
            {evaluation.advice ? (
              <p>
                <span className="text-muted">建议 </span>
                {evaluation.advice}
              </p>
            ) : null}
          </div>
        )}
      </Card.Content>
    </Card>
  );
}

function RecordDetailBody({ record }: { record: InterviewRecord }) {
  const overall = record.overallEvaluation;
  if (record.items.length === 0 && !overall) {
    return <p className="text-sm text-muted">本次面试暂无问答内容</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {overall ? <OverallEvaluationCard evaluation={overall} /> : null}
      {record.items.map((item, index) => (
        <Card
          key={item.id}
          className="border border-black/6 bg-[#f8f8f8] shadow-none"
          variant="secondary"
        >
          <Card.Header className="gap-1">
            <Card.Title className="text-sm">
              第 {index + 1} 题 · 面试官
            </Card.Title>
            <Card.Description className="text-sm leading-6 text-foreground whitespace-pre-wrap">
              {item.question || "（问题生成中或失败）"}
            </Card.Description>
          </Card.Header>
          <Card.Content className="border-t border-black/6 pt-3">
            <p className="mb-2 text-xs font-medium text-muted">
              {record.mode === "mock" ? "你的回答" : "AI 回答"}
            </p>
            {item.status === "error" && !item.answer ? (
              <p className="text-sm text-red-600">
                {item.error ?? "内容获取失败"}
              </p>
            ) : item.answer ? (
              <p className="text-sm leading-7 whitespace-pre-wrap">
                {item.answer}
              </p>
            ) : (
              <p className="text-sm text-muted">未作答</p>
            )}
            {item.evaluation ? (
              <div className="mt-4 border-t border-black/6 pt-3">
                <p className="mb-2 text-xs font-medium text-muted">AI 点评</p>
                {item.evaluation.status === "error" ? (
                  <p className="text-sm text-red-600">
                    {item.evaluation.error ?? "评估失败"}
                  </p>
                ) : (
                  <div className="flex flex-col gap-2 text-sm leading-7">
                    {item.evaluation.score != null ? (
                      <p>
                        <span className="text-muted">评分 </span>
                        <span className="font-medium">
                          {item.evaluation.score} / 10
                        </span>
                      </p>
                    ) : null}
                    {item.evaluation.advice ? (
                      <p>
                        <span className="text-muted">建议 </span>
                        {item.evaluation.advice}
                      </p>
                    ) : null}
                    {item.evaluation.improvements ? (
                      <p>
                        <span className="text-muted">改正点 </span>
                        {item.evaluation.improvements}
                      </p>
                    ) : null}
                  </div>
                )}
              </div>
            ) : null}
          </Card.Content>
        </Card>
      ))}
    </div>
  );
}

export function InterviewRecordsPage() {
  const [recordsDir, setRecordsDir] = useState("");
  const [records, setRecords] = useState<InterviewRecordSummary[]>([]);
  const [corrupted, setCorrupted] = useState<
    Array<{ fileName: string; error: string }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [changingDir, setChangingDir] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [detail, setDetail] = useState<InterviewRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const detailModal = useOverlayState();

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const result = await fetchInterviewRecords();
      setRecordsDir(result.recordsDir);
      setRecords(result.records);
      setCorrupted(result.corrupted);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "加载面试记录失败");
      setRecords([]);
      setCorrupted([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await fetchInterviewRecords();
        if (!active) return;
        setRecordsDir(result.recordsDir);
        setRecords(result.records);
        setCorrupted(result.corrupted);
        setLoadError("");
      } catch (error) {
        if (!active) return;
        setLoadError(
          error instanceof Error ? error.message : "加载面试记录失败",
        );
        setRecords([]);
        setCorrupted([]);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function handleChangeDir() {
    if (changingDir) return;
    setChangingDir(true);
    try {
      const result = await pickInterviewRecordsDir();
      if (!result) return;
      setRecordsDir(result.recordsDir);
      toast(
        result.migrated > 0
          ? `已切换文件夹，并迁移 ${result.migrated} 条记录`
          : "已切换保存文件夹",
      );
      await reload();
    } catch (error) {
      toast(error instanceof Error ? error.message : "更改保存文件夹失败");
    } finally {
      setChangingDir(false);
    }
  }

  async function openDetail(summary: InterviewRecordSummary) {
    setSelectedFileName(summary.fileName);
    setDetail(null);
    setDetailError("");
    setDetailLoading(true);
    detailModal.open();
    try {
      const record = await fetchInterviewRecord(summary.fileName);
      if (!record) {
        setDetailError("记录文件不存在或已被移动");
        return;
      }
      setDetail(record);
    } catch (error) {
      setDetailError(
        error instanceof Error ? error.message : "读取面试记录失败",
      );
    } finally {
      setDetailLoading(false);
    }
  }

  function handleDetailOpenChange(open: boolean) {
    detailModal.setOpen(open);
    if (!open) {
      setSelectedFileName(null);
      setDetail(null);
      setDetailError("");
      setDetailLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-10 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-3xl font-semibold tracking-tight">面试记录</h2>
          <Description className="mt-2">
            面试记录只保存在本地，不会上传。
          </Description>
        </div>
        <Button
          variant="outline"
          isDisabled={loading || changingDir}
          onPress={() => void reload()}
        >
          <RefreshCw className="size-4" />
          刷新
        </Button>
      </div>

      <Card className="mt-8 rounded-lg border border-black/6 p-4 shadow-none">
        <TextField className="w-full" name="records-dir">
          <Label>保存文件夹</Label>
          <div className="flex items-center gap-2">
            <Input
              fullWidth
              readOnly
              value={recordsDir || (loading ? "加载中…" : "")}
              placeholder="尚未设置保存文件夹"
            />
            <Button
              className="shrink-0 bg-brand text-white"
              isDisabled={changingDir}
              isPending={changingDir}
              onPress={() => void handleChangeDir()}
            >
              <FolderOpen className="size-4" />
              更改
            </Button>
          </div>
        </TextField>
      </Card>

      {loadError ? (
        <p className="mt-6 text-sm text-red-600">{loadError}</p>
      ) : null}

      {corrupted.length > 0 ? (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          有 {corrupted.length} 个文件无法解析，已从列表中隐藏：
          {corrupted
            .slice(0, 3)
            .map((item) => item.fileName)
            .join("、")}
          {corrupted.length > 3 ? "…" : ""}
        </div>
      ) : null}

      <div className="mt-8">
        {loading ? (
          <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted">
            <Spinner size="sm" />
            正在加载面试记录…
          </div>
        ) : records.length === 0 ? (
          <div className="grid min-h-40 place-items-center rounded-lg border border-dashed border-black/10 bg-white text-sm text-muted">
            暂无面试记录。完成一次正式面试或模拟面试后会出现在这里。
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {records.map((record) => (
              <button
                key={record.fileName}
                type="button"
                className="rounded-lg border border-black/6 bg-white px-5 py-4 text-left transition hover:border-black/20 hover:bg-[#fafafa]"
                onClick={() => void openDetail(record)}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Chip size="sm" variant="soft" color="accent">
                    <Chip.Label>{modeLabel(record.mode)}</Chip.Label>
                  </Chip>
                  {record.endedAt == null ? (
                    <Chip size="sm" variant="soft" color="warning">
                      <Chip.Label>未正常结束</Chip.Label>
                    </Chip>
                  ) : null}
                  {record.interviewDirection ? (
                    <span className="text-sm text-muted">
                      {record.interviewDirection}
                    </span>
                  ) : null}
                </div>
                <div className="mt-3 grid gap-1 text-sm sm:grid-cols-2">
                  <p>
                    <span className="text-muted">开始 </span>
                    {formatDateTime(record.startedAt)}
                  </p>
                  <p>
                    <span className="text-muted">结束 </span>
                    {record.endedAt ? formatDateTime(record.endedAt) : "未记录"}
                  </p>
                  <p>
                    <span className="text-muted">时长 </span>
                    {formatDuration(record.durationSeconds)}
                  </p>
                  <p>
                    <span className="text-muted">问答 </span>
                    {record.itemCount} 条
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <Modal.Backdrop
        isOpen={detailModal.isOpen}
        onOpenChange={handleDetailOpenChange}
      >
        <Modal.Container size="lg">
          <Modal.Dialog className="sm:max-w-4xl">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>
                {detail
                  ? `${modeLabel(detail.mode)}详情`
                  : selectedFileName
                    ? "面试记录详情"
                    : "面试记录详情"}
              </Modal.Heading>
            </Modal.Header>
            <Modal.Body className="max-h-[70vh] overflow-y-auto">
              {detailLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted">
                  <Spinner size="sm" />
                  正在读取记录…
                </div>
              ) : detailError ? (
                <p className="text-sm text-red-600">{detailError}</p>
              ) : detail ? (
                <div className="flex flex-col gap-4">
                  <div className="grid gap-1 rounded-lg bg-[#f8f8f8] px-4 py-3 text-sm sm:grid-cols-2">
                    <p>
                      <span className="text-muted">开始 </span>
                      {formatDateTime(detail.startedAt)}
                    </p>
                    <p>
                      <span className="text-muted">结束 </span>
                      {detail.endedAt
                        ? formatDateTime(detail.endedAt)
                        : "未正常结束"}
                    </p>
                    <p>
                      <span className="text-muted">时长 </span>
                      {formatDuration(detail.durationSeconds)}
                    </p>
                    <p>
                      <span className="text-muted">方向 </span>
                      {detail.interviewDirection || "未指定"}
                    </p>
                  </div>
                  <RecordDetailBody record={detail} />
                </div>
              ) : (
                <p className="text-sm text-muted">暂无内容</p>
              )}
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </div>
  );
}
