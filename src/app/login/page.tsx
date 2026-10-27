"use client";
import { useState } from "react";
import { api } from "@/components/client";
export default function Login() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <main className="login-wrap">
      <form
        className="login-panel"
        onSubmit={async (e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          setBusy(true);
          setError("");
          try {
            await api("auth/login", { password: data.get("password") });
            window.location.assign("/");
          } catch (e) {
            setError(String((e as Error).message));
          } finally {
            setBusy(false);
          }
        }}
      >
        <img src="/brand/manabit-horizontal.svg" width="160" alt="Manabit" />
        <h1>Tu centro de operaciones.</h1>
        <p>Acceso de David a recepción, agenda y agentes.</p>
        <label>
          Clave de administración
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            minLength={16}
          />
        </label>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button className="button primary" disabled={busy}>
          {busy ? "Entrando…" : "Entrar al panel"}
        </button>
        <a href="/reservar">Abrir atención al cliente</a>
      </form>
    </main>
  );
}
