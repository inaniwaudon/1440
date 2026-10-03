import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { Timeline } from "./components/Timeline";
import { MinuteDetail } from "./components/MinuteDetail";
import { ImportProgressOverlay } from "./components/ImportProgress";
import { ImportConflictOverlay } from "./components/ImportConflict";
import { InstallPrompt } from "./components/InstallPrompt";
import { FabMenu } from "./components/FabMenu";
import { OptionsModal } from "./components/OptionsModal";
import { ImageExportModal } from "./components/ImageExportModal";
import { exportContactSheet } from "./features/export/exportContactSheet";
import {
  importCameraPhoto,
  importBulkPhotos,
  type ImportProgress,
  type ImportResult,
  type ImportConflict,
} from "./features/import/importPhotos";

type ImportState =
  | { status: "idle" }
  | { status: "importing"; progress: ImportProgress }
  | { status: "done"; result: ImportResult };

const OPTIONS_STORAGE_KEY = "setlog-options";

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
  const [importState, setImportState] = useState<ImportState>({ status: "idle" });
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [options, setOptions] = useState<StoredOptions>(loadOptions);
  const [exportError, setExportError] = useState<string | null>(null);
  const [imageExportProgress, setImageExportProgress] = useState<{ current: number; total: number } | null>(null);
  const [exportedImageUrl, setExportedImageUrl] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{
    details: ImportConflict;
    resolve: (replace: boolean) => void;
  } | null>(null);

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
    setImportState({ status: "importing", progress: { total: 1, current: 0, currentFile: file.name } });
    try {
      const imported = await importCameraPhoto(file, compareReplacement);
      setImportState({ status: "done", result: { succeeded: imported ? 1 : 0, skipped: imported ? 0 : 1, failed: 0, errors: [] } });
    } catch (err) {
      setImportState({ status: "done", result: { succeeded: 0, skipped: 0, failed: 1, errors: [{ file: file.name, error: String(err) }] } });
    }
  };

  const handleBulkImport = async (files: File[]) => {
    if (files.length === 0) return;
    setImportState({ status: "importing", progress: { total: files.length, current: 0, currentFile: "" } });
    const result = await importBulkPhotos(files, (progress) => {
      setImportState({ status: "importing", progress });
    }, compareReplacement);
    setImportState({ status: "done", result });
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
        progress={importState.status === "importing" ? importState.progress : null}
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
          onOption={() => setOptionsOpen(true)}
        />
      )}

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
