"use client";

import { useEffect, useRef, useState } from "react";

// Google Identity Services (GIS): renders Google's own "Continue with Google"
// button and hands back an ID token ("credential") that the API verifies.
// Needs NEXT_PUBLIC_GOOGLE_CLIENT_ID — without it nothing is rendered and the
// auth forms simply offer password sign-in only.

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
const GIS_SRC = "https://accounts.google.com/gsi/client";

export const googleEnabled = CLIENT_ID.length > 0;

type ButtonText = "continue_with" | "signup_with" | "signin_with";

interface GoogleAccountsId {
  initialize(config: {
    client_id: string;
    callback: (response: { credential: string }) => void;
    ux_mode?: "popup" | "redirect";
    auto_select?: boolean;
    itp_support?: boolean;
  }): void;
  renderButton(
    parent: HTMLElement,
    options: {
      type?: "standard" | "icon";
      theme?: "outline" | "filled_blue" | "filled_black";
      size?: "large" | "medium" | "small";
      text?: ButtonText;
      shape?: "rectangular" | "pill" | "circle" | "square";
      logo_alignment?: "left" | "center";
      width?: number;
    }
  ): void;
}

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleAccountsId } };
  }
}

// Inject the GIS script once per page; a failed load clears the cache so a
// later mount can retry.
let gisLoad: Promise<GoogleAccountsId> | null = null;
function loadGis(): Promise<GoogleAccountsId> {
  if (!gisLoad) {
    gisLoad = new Promise<GoogleAccountsId>((resolve, reject) => {
      const ready = window.google?.accounts?.id;
      if (ready) return resolve(ready);
      const script = document.createElement("script");
      script.src = GIS_SRC;
      script.async = true;
      script.defer = true;
      script.onload = () => {
        const id = window.google?.accounts?.id;
        id ? resolve(id) : reject(new Error("Google Identity Services unavailable"));
      };
      script.onerror = () => reject(new Error("Could not load Google sign-in"));
      document.head.appendChild(script);
    });
    gisLoad.catch(() => {
      gisLoad = null;
    });
  }
  return gisLoad;
}

export function GoogleButton({ onCredential, text = "continue_with" }: { onCredential: (credential: string) => void; text?: ButtonText }) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(onCredential);
  latest.current = onCredential;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!googleEnabled || !host.current) return;
    let cancelled = false;
    loadGis()
      .then((id) => {
        const el = host.current;
        if (cancelled || !el) return;
        // initialize() is global to the page: re-running it on mount means the
        // form currently on screen (login vs register) owns the callback.
        id.initialize({
          client_id: CLIENT_ID,
          callback: (r) => latest.current(r.credential),
          ux_mode: "popup",
          itp_support: true,
        });
        el.innerHTML = "";
        id.renderButton(el, {
          type: "standard",
          theme: "outline",
          size: "large",
          text,
          shape: "rectangular",
          logo_alignment: "center",
          // GIS caps the button at 400px; match the form width below that.
          width: Math.min(400, Math.max(200, Math.floor(el.clientWidth) || 380)),
        });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [text]);

  if (!googleEnabled) return null;
  if (failed) {
    return <div style={{ fontSize: 12.5, color: "#a39a8d", fontWeight: 600, textAlign: "center" }}>Google sign-in is unavailable right now.</div>;
  }
  return <div ref={host} style={{ display: "flex", justifyContent: "center", minHeight: 44 }} />;
}
