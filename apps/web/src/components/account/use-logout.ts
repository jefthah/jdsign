"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { browserApi } from "@/lib/api/browser";

/** Ends the session, then goes to the home page so every server-rendered header drops the account. */
export function useLogout() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    try {
      await browserApi.POST("/auth/logout");
    } finally {
      router.replace("/");
      router.refresh();
    }
  }

  return { busy, logout: () => void logout() };
}
