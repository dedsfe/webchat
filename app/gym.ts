export const GYM_ACTIVITIES = ["Musculação", "Corrida", "Caminhada", "Bike", "Esporte", "Outro"] as const;

export type GymActivity = (typeof GYM_ACTIVITIES)[number];

export type GymCheckin = {
  type: "gym_checkin";
  activity: GymActivity;
  date: string;
  minutes?: number;
  note?: string;
};

export type GymGoal = { type: "gym_goal"; target: number };
export type GymDeleted = { type: "gym_deleted" };
export type GymContent = GymCheckin | GymGoal | GymDeleted;

export type GymMessage = {
  id: string;
  author: string;
  content: string;
  created_at: string;
};

export function localDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function weekDates(today: Date): string[] {
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(monday);
    day.setDate(monday.getDate() + index);
    return localDate(day);
  });
}

export function parseGymContent(content: string): GymContent | null {
  if (!content.startsWith('{"type":"gym_')) return null;
  try {
    const value: unknown = JSON.parse(content);
    if (!value || typeof value !== "object" || !("type" in value)) return null;
    const item = value as Record<string, unknown>;
    if (item.type === "gym_checkin" &&
        typeof item.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.date) &&
        GYM_ACTIVITIES.includes(item.activity as GymActivity)) {
      return {
        type: "gym_checkin",
        date: item.date,
        activity: item.activity as GymActivity,
        minutes: typeof item.minutes === "number" && item.minutes > 0 && item.minutes <= 600 ? item.minutes : undefined,
        note: typeof item.note === "string" ? item.note.slice(0, 180) : undefined,
      };
    }
    if (item.type === "gym_goal" && typeof item.target === "number" && Number.isInteger(item.target) && item.target >= 1 && item.target <= 7) {
      return { type: "gym_goal", target: item.target };
    }
    if (item.type === "gym_deleted") return { type: "gym_deleted" };
  } catch {
    return null;
  }
  return null;
}

export function getGymGoal(messages: GymMessage[]): number {
  const latest = messages
    .filter((message) => parseGymContent(message.content)?.type === "gym_goal")
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const goal = latest ? parseGymContent(latest.content) : null;
  return goal?.type === "gym_goal" ? goal.target : 3;
}

export function getWeekCheckins(messages: GymMessage[], today: Date): Array<GymMessage & { workout: GymCheckin }> {
  const days = new Set(weekDates(today));
  return messages.flatMap((message) => {
    const workout = parseGymContent(message.content);
    return workout?.type === "gym_checkin" && days.has(workout.date) ? [{ ...message, workout }] : [];
  });
}
