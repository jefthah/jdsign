"use client";

import { useEffect, useState } from "react";

/** The authenticator secret in groups of four, with a copy button, for apps that cannot scan. */
export function SecretKey({ secret }: { secret: string }) {
  const [copied, setCopied] = useState(false);
  const grouped = secret.match(/.{1,4}/g)?.join(" ") ?? secret;

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
    } catch {
      // Without clipboard access the key can still be selected and copied by hand.
    }
  }

  return (
    <div className="adm-secret">
      <span className="adm-secret-label">Tidak bisa memindai? Ketik kunci ini di aplikasi:</span>
      <code className="adm-secret-code">{grouped}</code>
      <button type="button" className="adm-copy" onClick={() => void copy()} aria-live="polite">
        {copied ? "Kunci tersalin" : "Salin kunci"}
      </button>
    </div>
  );
}
