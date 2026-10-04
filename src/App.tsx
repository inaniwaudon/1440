import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
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
};

const defaultOptions: StoredOptions = {
  showOnlyWithImages: false,
};

function loadOptions(): StoredOptions {
  try {
    const stored = localStorage.getItem(OPTIONS_STORAGE_KEY);
    if (!stored) return defaultOptions;

    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== "object" || parsed === null) return defaultOptions;

    const options = parsed as Partial<StoredOptions>;
    return {
      showOnlyWithImages:
        typeof options.showOnlyWithImages === "boolean"
          ? options.showOnlyWithImages
          : defaultOptions.showOnlyWithImages,
    };
  } catch {
    return defaultOptions;
  }
}

export default function App() {
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
  const exportedDownloadUrlsRef = useRef<string[]>([]);
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
      for (const url of exportedDownloadUrlsRef.current)
        URL.revokeObjectURL(url);
      exportedDownloadUrlsRef.current = [];
    },
    [],
  );

  useEffect(() => {
    try {
      localStorage.setItem(OPTIONS_STORAGE_KEY, JSON.stringify(options));
    } catch {
      // Keep options usable for this session when storage is unavailable.
    }
  }, [options]);

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
    if (files.length === 0) return;
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
      label: "画像",
      current: 0,
      total: 0,
    });
    try {
      const destination = await exportArchive((p) => {
        setTransferPhase({
          kind: "exporting",
          step: p.step,
          totalSteps: p.totalSteps,
          label: p.label,
          current: p.current,
          total: p.total,
        });
      });
      if (destination.kind === "saved") {
        setTransferPhase({ kind: "export-done", files: [] });
      } else {
        for (const url of exportedDownloadUrlsRef.current) {
          URL.revokeObjectURL(url);
        }
        exportedDownloadUrlsRef.current = [];
        const files = destination.files.map((file) => {
          const url = URL.createObjectURL(file.blob);
          exportedDownloadUrlsRef.current.push(url);
          return { file, download: { url, name: file.name } };
        });
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

  const handleImportFile = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const fileList = event.target.files;
    const files = fileList ? Array.from(fileList) : [];
    event.target.value = "";
    if (files.length === 0) return;
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

      // Main archives first so video archives can attach to existing records.
      const sorted = [
        ...entries.filter((e) => e.summary.kind === "main"),
        ...entries.filter((e) => e.summary.kind === "video"),
      ];

      for (let i = 0; i < sorted.length; i++) {
        const { file, summary } = sorted[i];
        const label =
          summary.kind === "main"
            ? `画像（${i + 1}/${sorted.length}）`
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
            ? await importArchive(file, summary, (p) => {
                setTransferPhase({
                  kind: "importing",
                  label,
                  current: p.current,
                  total: p.total,
                  phase: p.phase,
                });
              })
            : await importVideoArchive(file, summary, (p) => {
                setTransferPhase({
                  kind: "importing",
                  label,
                  current: p.current,
                  total: p.total,
                  phase: p.phase,
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
    for (const url of exportedDownloadUrlsRef.current) URL.revokeObjectURL(url);
    exportedDownloadUrlsRef.current = [];
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
        if (previous) URL.revokeObjectURL(previous);
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
      "すべての画像と記録を削除します。この操作は取り消せません。",
    );
    if (!confirmed) return;

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

  return (
    <>
      <Timeline
        onSelectMinute={selectMinute}
        showOnlyWithImages={options.showOnlyWithImages}
      />

      <MinuteDetail
        minuteOfDay={selectedMinute}
        onClose={closeMinute}
        onNavigate={setSelectedMinute}
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
        exportError={exportError}
        onExportImage={handleExportImage}
        imageExportProgress={imageExportProgress}
        onExportData={handleExportData}
        onImportData={handleImportDataClick}
        transferBusy={transferPhase !== null}
        onDeleteAllData={handleDeleteAllData}
        deleteBusy={deleteBusy}
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
            if (previous) URL.revokeObjectURL(previous);
            return null;
          });
        }}
      />

      <InstallPrompt />
    </>
  );
}
