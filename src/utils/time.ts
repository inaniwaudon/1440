export const toMinuteOfDay = (hour: number, minute: number): number => {
  return hour * 60 + minute;
};

export const fromMinuteOfDay = (
  value: number,
): {
  hour: number;
  minute: number;
} => {
  return { hour: Math.floor(value / 60), minute: value % 60 };
};

export const formatMinuteOfDay = (value: number): string => {
  const { hour, minute } = fromMinuteOfDay(value);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
};

export const getMinuteOfDayFromDate = (date: Date): number => {
  return date.getHours() * 60 + date.getMinutes();
};

export const formatCapturedDate = (
  capturedAt: string | null | undefined,
): string | null => {
  if (!capturedAt) {
    return null;
  }

  const date = new Date(capturedAt);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
};
