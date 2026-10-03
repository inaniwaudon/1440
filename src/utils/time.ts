export function toMinuteOfDay(hour: number, minute: number): number {
  return hour * 60 + minute;
}

export function fromMinuteOfDay(value: number): { hour: number; minute: number } {
  return { hour: Math.floor(value / 60), minute: value % 60 };
}

export function formatMinuteOfDay(value: number): string {
  const { hour, minute } = fromMinuteOfDay(value);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function getMinuteOfDayFromDate(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}
