import { useState } from "react";
import { flushSync } from "react-dom";
import { Timeline } from "./components/Timeline";
import { MinuteDetail } from "./components/MinuteDetail";
import { ImportProgressOverlay } from "./components/ImportProgress";
import { ImportConflictOverlay } from "./components/ImportConflict";
import { InstallPrompt } from "./components/InstallPrompt";
import { FabMenu } from "./components/FabMenu";
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

export default function App() {
  const [selectedMinute, setSelectedMinute] = useState<number | null>(null);
  const [importState, setImportState] = useState<ImportState>({ status: "idle" });
  const [conflict, setConflict] = useState<{
    details: ImportConflict;
    resolve: (replace: boolean) => void;
  } | null>(null);

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
    if (selectedMinute === null || !document.startViewTransition) {
      setSelectedMinute(null);
      return;
    }

    const minuteOfDay = selectedMinute;
    const transitionName = `minute-photo-${minuteOfDay}`;
    const transition = document.startViewTransition(() => {
      flushSync(() => setSelectedMinute(null));
      const cell = document.querySelector<HTMLElement>(`[data-minute="${minuteOfDay}"]`);
      if (cell) cell.style.viewTransitionName = transitionName;
    });
    transition.finished.finally(() => {
      const cell = document.querySelector<HTMLElement>(`[data-minute="${minuteOfDay}"]`);
      if (cell) cell.style.viewTransitionName = "";
    });
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

  return (
    <>
      <Timeline onSelectMinute={selectMinute} />

      <MinuteDetail
        minuteOfDay={selectedMinute}
        onClose={closeMinute}
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

      <FabMenu
        onCamera={handleCameraFile}
        onImport={handleBulkImport}
      />

      <InstallPrompt />
    </>
  );
}
