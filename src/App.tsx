import type { ChangeEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { LandscapeSlideshow } from "./components/landscape/LandscapeSlideshow";
import { MinuteDetail } from "./components/minute/MinuteDetail";
import { HelpModal } from "./components/modals/HelpModal";
import { ImageExportModal } from "./components/modals/ImageExportModal";
import { ImportConflictOverlay } from "./components/modals/ImportConflict";
import { ImportProgressOverlay } from "./components/modals/ImportProgress";
import { OptionsModal } from "./components/modals/OptionsModal";
import {
  type TransferPhase,
  TransferProgressOverlay,
} from "./components/modals/TransferProgress";
import { FabMenu } from "./components/shell/FabMenu";
import { InstallPrompt } from "./components/shell/InstallPrompt";
import { Timeline } from "./components/timeline/Timeline";
import { db } from "./db/db";
import { exportContactSheet } from "./features/export/exportContactSheet";
import {
  type ImportConflict,
  type ImportProgress,
  type ImportResult,
  importBulkPhotos,
  importCameraPhoto,
} from "./features/import/importPhotos";
import {
  cleanupExportedArchive,
  exportArchive,
} from "./features/transfer/exportArchive";
import {
  type AnyArchiveSummary,
  importArchive,
  importVideoArchive,
  readArchiveMetadata,
} from "./features/transfer/importArchive";

type ImportState =
  | { status: "idle" }
  | { status: "importing"; progress: ImportProgress }
  | { status: "done"; result: ImportResult };

const OPTIONS_STORAGE_KEY = "1440-options";

type StoredOptions = {
  showOnlyWithImages: boolean;
  blurImages: boolean;
};

type StoragePersistence =
  | "unsupported"
  | "checking"
  | "temporary"
  | "persistent";

const formatBytes = (bytes: number): string => {
  if (bytes < 1024 * 1024) {
    return `${Math.ceil(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const defaultOptions: StoredOptions = {
  showOnlyWithImages: false,
  blurImages: false,
};

const loadOptions = (): StoredOptions => {
  try {
    const stored = localStorage.getItem(OPTIONS_STORAGE_KEY);
    if (!stored) {
      return defaultOptions;
    }

    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== "object" || parsed === null) {
      return defaultOptions;
    }

    const options = parsed as Partial<StoredOptions>;
    return {
      showOnlyWithImages:
        typeof options.showOnlyWithImages === "boolean"
          ? options.showOnlyWithImages
          : defaultOptions.showOnlyWithImages,
      blurImages:
        typeof options.blurImages === "boolean"
          ? options.blurImages
          : defaultOptions.blurImages,
    };
  } catch {
    return defaultOptions;
  }
};

const App = () => {
  const [selectedMinute, setSelectedMinute] = useState<number | null>(null);
  const [importState, setImportState] = useState<ImportState>({
    status: "idle",
  });
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [options, setOptions] = useState<StoredOptions>(loadOptions);
  const [exportError, setExportError] = useState<string | null>(null);
  const [imageExportProgress, setImageExportProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [exportedImageUrl, setExportedImageUrl] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [storagePersistence, setStoragePersistence] =
    useState<StoragePersistence>("checking");
  const [storageUsage, setStorageUsage] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{
    details: ImportConflict;
    resolve: (replace: boolean) => void;
  } | null>(null);
  const [transferPhase, setTransferPhase] = useState<TransferPhase | null>(
    null,
  );
  const importFileInputRef = useRef<HTMLInputElement | null>(null);
  const exportedDownloadUrlRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (exportedDownloadUrlRef.current) {
        URL.revokeObjectURL(exportedDownloadUrlRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    db.photos.count().then((count) => {
      if (!cancelled && count === 0) {
        setHelpOpen(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(OPTIONS_STORAGE_KEY, JSON.stringify(options));
    } catch {
      // ストレージが利用不可の場合でも、当該セッション中はオプションを使用できるようにする
    }
  }, [options]);

  useEffect(() => {
    if (!optionsOpen) {
      return;
    }
    const storage = navigator.storage;
    if (!storage?.persisted || !storage.persist) {
      setStoragePersistence("unsupported");
    }

    let cancelled = false;
    if (storage?.persisted) {
      void storage.persisted().then((persistent) => {
        if (cancelled) {
          return;
        }
        setStoragePersistence(persistent ? "persistent" : "temporary");
      });
    }

    void (async () => {
      try {
        const photos = await db.photos.toArray();
        if (cancelled) {
          return;
        }
        let photoBytes = 0;
        let videoBytes = 0;
        for (const photo of photos) {
          photoBytes +=
            (photo.thumbnailBlob?.size ?? 0) + (photo.previewBlob?.size ?? 0);
          videoBytes += photo.videoBlob?.size ?? 0;
        }
        const total = photoBytes + videoBytes;
        setStorageUsage(
          `${formatBytes(total)}（写真 ${formatBytes(photoBytes)}、動画 ${formatBytes(videoBytes)}）`,
        );
      } catch {
        if (!cancelled) {
          setStorageUsage(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [optionsOpen]);

  const handleRequestStoragePersistence = async () => {
    setStoragePersistence("checking");
    try {
      const persistent = await navigator.storage.persist();
      setStoragePersistence(persistent ? "persistent" : "temporary");
    } catch {
      setStoragePersistence("temporary");
    }
  };

  const selectMinute = (minuteOfDay: number, cell: HTMLElement) => {
    const transitionName = `minute-photo-${minuteOfDay}`;
    cell.style.viewTransitionName = transitionName;

    if (!document.startViewTransition) {
      cell.style.viewTransitionName = "";
      setSelectedMinute(minuteOfDay);
      return;
    }

    const transition = document.startViewTransition(() => {
      cell.style.viewTransitionName = "";
      flushSync(() => setSelectedMinute(minuteOfDay));
    });
    transition.finished.finally(() => {
      cell.style.viewTransitionName = "";
    });
  };

  const closeMinute = () => {
    setSelectedMinute(null);
  };

  const compareReplacement = (details: ImportConflict) =>
    new Promise<boolean>((resolve) => setConflict({ details, resolve }));

  const resolveConflict = (replace: boolean) => {
    conflict?.resolve(replace);
    setConflict(null);
  };

  const handleCameraFile = async (file: File) => {
    setImportState({
      status: "importing",
      progress: { total: 1, current: 0, currentFile: file.name },
    });
    try {
      const imported = await importCameraPhoto(file, compareReplacement);
      setImportState({
        status: "done",
        result: {
          succeeded: imported ? 1 : 0,
          skipped: imported ? 0 : 1,
          failed: 0,
          errors: [],
        },
      });
    } catch (err) {
      setImportState({
        status: "done",
        result: {
          succeeded: 0,
          skipped: 0,
          failed: 1,
          errors: [{ file: file.name, error: String(err) }],
        },
      });
    }
  };

  const handleBulkImport = async (files: File[]) => {
    if (files.length === 0) {
      return;
    }
    setImportState({
      status: "importing",
      progress: { total: files.length, current: 0, currentFile: "" },
    });
    const result = await importBulkPhotos(
      files,
      (progress) => {
        setImportState({ status: "importing", progress });
      },
      compareReplacement,
    );
    setImportState({ status: "done", result });
  };

  const handleExportData = async () => {
    setExportError(null);
    setTransferPhase({
      kind: "exporting",
      step: 1,
      totalSteps: 1,
      label: "写真",
      current: 0,
      total: 0,
    });
    try {
      const destination = await exportArchive((progress) => {
        setTransferPhase({
          kind: "exporting",
          step: progress.step,
          totalSteps: progress.totalSteps,
          label: progress.label,
          current: progress.current,
          total: progress.total,
        });
      });
      if (destination.kind === "saved") {
        setTransferPhase({ kind: "export-done", files: [] });
      } else {
        const files = destination.files.map((file) => ({ file }));
        setTransferPhase({ kind: "export-done", files });
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setTransferPhase(null);
        return;
      }
      setExportError(err instanceof Error ? err.message : String(err));
      setTransferPhase(null);
    }
  };

  const handleImportDataClick = () => {
    importFileInputRef.current?.click();
  };

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const fileList = event.target.files;
    const files = fileList ? Array.from(fileList) : [];
    event.target.value = "";
    if (files.length === 0) {
      return;
    }
    setExportError(null);
    setTransferPhase({
      kind: "importing",
      label: `${files.length} 件を読み取り中`,
      current: 0,
      total: files.length,
      phase: "scan",
    });
    try {
      const entries: Array<{ file: File; summary: AnyArchiveSummary }> = [];
      for (let i = 0; i < files.length; i++) {
        setTransferPhase({
          kind: "importing",
          label: `${files[i].name}`,
          current: i,
          total: files.length,
          phase: "scan",
        });
        const summary = await readArchiveMetadata(files[i]);
        entries.push({ file: files[i], summary });
      }

      const combined = {
        imported: 0,
        skipped: 0,
        failed: 0,
        errors: [] as Array<{ id: string; error: string }>,
      };

      // 動画アーカイブが既存レコードに紐付けできるように、メインアーカイブを先に処理する
      const sorted = [
        ...entries.filter((entry) => entry.summary.kind === "main"),
        ...entries.filter((entry) => entry.summary.kind === "video"),
      ];

      for (let i = 0; i < sorted.length; i++) {
        const { file, summary } = sorted[i];
        const label =
          summary.kind === "main"
            ? `写真（${i + 1}/${sorted.length}）`
            : `動画（${i + 1}/${sorted.length}）`;
        setTransferPhase({
          kind: "importing",
          label,
          current: 0,
          total:
            summary.kind === "main"
              ? summary.photos.length
              : summary.manifest.videos.length,
          phase: "write",
        });
        const result =
          summary.kind === "main"
            ? await importArchive(file, summary, (progress) => {
                setTransferPhase({
                  kind: "importing",
                  label,
                  current: progress.current,
                  total: progress.total,
                  phase: progress.phase,
                });
              })
            : await importVideoArchive(file, summary, (progress) => {
                setTransferPhase({
                  kind: "importing",
                  label,
                  current: progress.current,
                  total: progress.total,
                  phase: progress.phase,
                });
              });
        combined.imported += result.imported;
        combined.skipped += result.skipped;
        combined.failed += result.failed;
        combined.errors.push(...result.errors);
      }
      setTransferPhase({ kind: "import-done", result: combined });
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err));
      setTransferPhase(null);
    }
  };

  const handleTransferClose = () => {
    setTransferPhase(null);
    if (exportedDownloadUrlRef.current) {
      URL.revokeObjectURL(exportedDownloadUrlRef.current);
      exportedDownloadUrlRef.current = null;
    }
    cleanupExportedArchive().catch(() => {});
  };

  const handleExportImage = async () => {
    setExportError(null);
    setImageExportProgress({ current: 0, total: 0 });
    try {
      const result = await exportContactSheet((current, total) => {
        setImageExportProgress({ current, total });
      });
      const url = URL.createObjectURL(result.blob);
      setExportedImageUrl((previous) => {
        if (previous) {
          URL.revokeObjectURL(previous);
        }
        return url;
      });
    } catch (error) {
      setExportError(error instanceof Error ? error.message : String(error));
    } finally {
      setImageExportProgress(null);
    }
  };

  const handleDeleteAllData = async () => {
    const confirmed = window.confirm(
      "すべての写真と動画を削除します。この操作は取り消せません。",
    );
    if (!confirmed) {
      return;
    }

    setDeleteBusy(true);
    setExportError(null);
    try {
      await db.transaction("rw", db.photos, db.slots, async () => {
        await Promise.all([db.photos.clear(), db.slots.clear()]);
      });
      localStorage.removeItem(OPTIONS_STORAGE_KEY);
      setOptions(defaultOptions);
      setSelectedMinute(null);
      setOptionsOpen(false);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : String(error));
    } finally {
      setDeleteBusy(false);
    }
  };

  // タイムライン画面（モーダル等が開いていない状態）でのみ、横向きスライドショーを起動する
  const isTimelineScreen =
    selectedMinute === null &&
    !optionsOpen &&
    !helpOpen &&
    conflict === null &&
    transferPhase === null &&
    importState.status === "idle" &&
    imageExportProgress === null &&
    exportedImageUrl === null;

  return (
    <>
      <Timeline
        onSelectMinute={selectMinute}
        showOnlyWithImages={options.showOnlyWithImages}
        blurImages={options.blurImages}
      />

      <LandscapeSlideshow
        enabled={isTimelineScreen}
        blurImages={options.blurImages}
      />

      <MinuteDetail
        minuteOfDay={selectedMinute}
        onClose={closeMinute}
        onNavigate={setSelectedMinute}
        blurImages={options.blurImages}
      />

      <ImportProgressOverlay
        progress={
          importState.status === "importing" ? importState.progress : null
        }
        result={importState.status === "done" ? importState.result : null}
        onClose={() => setImportState({ status: "idle" })}
      />

      <ImportConflictOverlay
        conflict={conflict?.details ?? null}
        onResolve={resolveConflict}
      />

      {selectedMinute === null && (
        <FabMenu
          onCamera={handleCameraFile}
          onImport={handleBulkImport}
          onHelp={() => setHelpOpen(true)}
          onOption={() => setOptionsOpen(true)}
        />
      )}

      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />

      <OptionsModal
        open={optionsOpen}
        onClose={() => setOptionsOpen(false)}
        showOnlyWithImages={options.showOnlyWithImages}
        onShowOnlyWithImagesChange={(showOnlyWithImages) =>
          setOptions((current) => ({ ...current, showOnlyWithImages }))
        }
        blurImages={options.blurImages}
        onBlurImagesChange={(blurImages) =>
          setOptions((current) => ({ ...current, blurImages }))
        }
        exportError={exportError}
        onExportImage={handleExportImage}
        imageExportProgress={imageExportProgress}
        onExportData={handleExportData}
        onImportData={handleImportDataClick}
        transferBusy={transferPhase !== null}
        onDeleteAllData={handleDeleteAllData}
        deleteBusy={deleteBusy}
        storagePersistence={storagePersistence}
        storageUsage={storageUsage}
        onRequestStoragePersistence={handleRequestStoragePersistence}
      />

      <TransferProgressOverlay
        phase={transferPhase}
        onClose={handleTransferClose}
      />

      <input
        ref={importFileInputRef}
        type="file"
        accept=".zip,application/zip"
        multiple
        style={{ display: "none" }}
        onChange={handleImportFile}
      />

      <ImageExportModal
        url={exportedImageUrl}
        onClose={() => {
          setExportedImageUrl((previous) => {
            if (previous) {
              URL.revokeObjectURL(previous);
            }
            return null;
          });
        }}
      />

      <InstallPrompt />
    </>
  );
};

export default App;
