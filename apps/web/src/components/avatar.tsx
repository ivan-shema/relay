"use client";

import { useRef, useState } from "react";
import type { AuthUser } from "@relay/shared";
import { api, ApiError } from "@/lib/api";

// Profile picture with an initials fallback. `editable` adds change/remove
// controls; the API deletes the previous image from storage on every change.
export function Avatar({
  user,
  size,
  editable = false,
  onChanged,
  style,
}: {
  user: (Pick<AuthUser, "firstName" | "lastName"> & { avatarUrl?: string | null }) | null;
  size: number;
  editable?: boolean;
  onChanged?: () => void | Promise<void>;
  style?: React.CSSProperties;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initials = user ? `${user.firstName[0] ?? ""}${user.lastName[0] ?? ""}`.toUpperCase() : "?";
  const circle: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: "50%",
    background: "linear-gradient(135deg,#ff8a3d,#e0560c)",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: Math.round(size * 0.38),
    fontWeight: 700,
    flex: "none",
    overflow: "hidden",
    ...style,
  };
  const face = user?.avatarUrl
    ? <img src={user.avatarUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
    : initials;

  if (!editable) return <div style={circle}>{face}</div>;

  const pick = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await api.uploadAvatar(file);
      await onChanged?.();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not upload the picture");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.removeAvatar();
      await onChanged?.();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not remove the picture");
    } finally {
      setBusy(false);
    }
  };

  const badge = Math.max(24, Math.round(size * 0.36));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, flex: "none" }}>
      <div style={{ position: "relative", flex: "none" }}>
        <div style={circle}>{face}</div>
        <button
          type="button"
          disabled={busy}
          onClick={() => input.current?.click()}
          title="Change photo"
          aria-label="Change photo"
          style={{ position: "absolute", right: -3, bottom: -3, width: badge, height: badge, borderRadius: "50%", background: "#fff", border: "1px solid #e3ddd1", color: "#1b1714", fontSize: Math.round(badge * 0.5), cursor: busy ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 10px -4px rgba(0,0,0,.45)", padding: 0 }}
        >
          {busy ? "…" : "✎"}
        </button>
        <input ref={input} type="file" accept=".jpg,.jpeg,.png,.webp" style={{ display: "none" }} onChange={(e) => pick(e.target.files?.[0] ?? null)} />
      </div>
      {(user?.avatarUrl || error) && (
        <div style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.3 }}>
          {error
            ? <span style={{ color: "#ff9c58" }}>{error}</span>
            : <button type="button" disabled={busy} onClick={remove} style={{ background: "none", border: "none", color: "#9a9186", cursor: "pointer", fontSize: 12, fontWeight: 700, padding: 0, fontFamily: "'Manrope', sans-serif" }}>Remove photo</button>}
        </div>
      )}
    </div>
  );
}
