"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { browserApi } from "@/lib/api/browser";

import { styles } from "./auth-styles";

export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    try {
      await browserApi.POST("/auth/logout");
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  return (
    <button type="button" className={styles.ghostButton} onClick={() => void logout()} disabled={busy}>
      {busy ? "Keluar…" : "Keluar"}
    </button>
  );
}
