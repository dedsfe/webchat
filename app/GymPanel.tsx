"use client";

import { useEffect, useRef, useState } from "react";
import {
  GYM_ACTIVITIES,
  getGymGoal,
  getWeekCheckins,
  localDate,
  weekDates,
  type GymActivity,
  type GymCheckin,
  type GymMessage,
} from "./gym";

type GymPanelProps = {
  name: string;
  participants: string[];
  messages: GymMessage[];
  onClose: () => void;
  onCheckin: (workout: GymCheckin) => Promise<boolean>;
  onGoalChange: (target: number) => Promise<boolean>;
};

const DAYS = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];

export default function GymPanel({ name, participants, messages, onClose, onCheckin, onGoalChange }: GymPanelProps) {
  const today = new Date();
  const todayKey = localDate(today);
  const dates = weekDates(today);
  const workouts = getWeekCheckins(messages, today);
  const currentGoal = getGymGoal(messages);
  const [activity, setActivity] = useState<GymActivity>("Musculação");
  const [date, setDate] = useState(todayKey);
  const [minutes, setMinutes] = useState("");
  const [note, setNote] = useState("");
  const [goal, setGoal] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { closeRef.current?.focus(); }, []);

  function keepFocusInside(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key !== "Tab" || !panelRef.current) return;
    const focusables = panelRef.current.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled)");
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  async function saveWorkout(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dates.includes(date) || date > todayKey || saving) return;
    setSaving(true);
    const result = await onCheckin({
      type: "gym_checkin",
      activity,
      date,
      minutes: minutes ? Number(minutes) : undefined,
      note: note.trim().slice(0, 180) || undefined,
    });
    if (!result) setSaving(false);
  }

  async function saveGoal() {
    if (goal === null || goal === currentGoal || saving) return;
    setSaving(true);
    const result = await onGoalChange(goal);
    setSaving(false);
    if (result) setGoal(null);
  }

  const shownParticipants = participants.slice(0, 2);
  const startLabel = new Date(`${dates[0]}T12:00:00`).toLocaleDateString("pt-BR", { day: "numeric", month: "short" });
  const endLabel = new Date(`${dates[6]}T12:00:00`).toLocaleDateString("pt-BR", { day: "numeric", month: "short" });

  return (
    <div className="gym-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={panelRef} className="gym-panel" role="dialog" aria-modal="true" aria-labelledby="gym-title" onKeyDown={keepFocusInside}>
        <header className="gym-header">
          <div>
            <span className="gym-header-mark" aria-hidden="true">↗</span>
            <h2 id="gym-title">Treinos da semana</h2>
            <p>{startLabel} a {endLabel} · meta em dupla</p>
          </div>
          <button ref={closeRef} type="button" className="gym-close" onClick={onClose} aria-label="Fechar treinos">×</button>
        </header>

        <div className="gym-content">
          <div className="gym-week" aria-label="Progresso da semana">
            <div className="gym-week-head">
              <strong>Juntos no ritmo</strong>
              <span>{currentGoal} {currentGoal === 1 ? "treino" : "treinos"} por pessoa</span>
            </div>
            <div className="gym-days" aria-hidden="true">
              <span />
              {DAYS.map((day, index) => <span key={day} className={dates[index] === todayKey ? "gym-today" : ""}>{day}</span>)}
              <span />
            </div>
            {shownParticipants.map((person, index) => {
              const personWorkouts = workouts.filter((entry) => entry.author === person);
              return (
                <div className="gym-person" key={person}>
                  <span className="gym-person-name" title={person}>{person === name ? "Você" : person}</span>
                  {dates.map((day) => {
                    const count = personWorkouts.filter((entry) => entry.workout.date === day).length;
                    return <span key={day} className={`gym-day-cell ${count ? "has-workout" : ""} ${index ? "gym-partner" : ""}`} title={`${count} ${count === 1 ? "treino" : "treinos"} em ${day}`}>{count || ""}</span>;
                  })}
                  <strong className="gym-person-score">{personWorkouts.length}/{currentGoal}</strong>
                </div>
              );
            })}
            {shownParticipants.length < 2 && <p className="gym-partner-hint">Quando a outra pessoa registrar um treino, o progresso dela aparece aqui.</p>}
          </div>

          <form className="gym-form" onSubmit={saveWorkout}>
            <h3>Registrar treino</h3>
            <div className="gym-activities" role="group" aria-label="Tipo de atividade">
              {GYM_ACTIVITIES.map((option) => (
                <button key={option} type="button" className={activity === option ? "selected" : ""} onClick={() => setActivity(option)} aria-pressed={activity === option}>{option}</button>
              ))}
            </div>
            <div className="gym-form-row">
              <label><span className="gym-field-title">Dia</span><input type="date" lang="pt-BR" value={date} min={dates[0]} max={todayKey} onChange={(event) => setDate(event.target.value)} required /></label>
              <label><span className="gym-field-title">Minutos <em>(opcional)</em></span><input type="number" min="1" max="600" inputMode="numeric" value={minutes} onChange={(event) => setMinutes(event.target.value)} placeholder="45" /></label>
            </div>
            <label className="gym-note-label"><span className="gym-field-title">Uma nota para vocês <em>(opcional)</em></span><textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={180} rows={2} placeholder="Como foi o treino?" /></label>
            <button type="submit" className="gym-submit" disabled={saving || !date || date > todayKey || date < dates[0]}>{saving ? "Salvando..." : "Registrar no chat"}</button>
          </form>

          <div className="gym-goal">
            <div><strong>Meta semanal</strong><p>A mesma meta vale para cada um.</p></div>
            <div className="gym-goal-controls">
              <select aria-label="Treinos por pessoa a cada semana" value={goal ?? currentGoal} onChange={(event) => setGoal(Number(event.target.value))}>
                {Array.from({ length: 7 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}× / semana</option>)}
              </select>
              <button type="button" onClick={saveGoal} disabled={saving || goal === null || goal === currentGoal}>Salvar</button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
