"use client";

import { Fragment, useState } from "react";

import { styles } from "./auth-styles";

const positions = [0, 1, 2, 3, 4, 5];

/**
 * Six-digit code field. One real input (so paste, autofill and
 * autocomplete="one-time-code" work) sits invisibly over six drawn boxes.
 */
export function OtpInput({
  value,
  onChange,
  invalid,
  busy,
  describedBy,
  label = "Kode verifikasi 6 digit",
  autoFocus = true,
}: {
  value: string;
  onChange: (digits: string) => void;
  invalid: boolean;
  /** Read-only rather than disabled while checking, so focus stays put for the next try. */
  busy: boolean;
  describedBy: string;
  label?: string;
  /** Off where focusing would scroll content the person must read first out of view. */
  autoFocus?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const activeIndex = Math.min(value.length, 5);

  return (
    <div className={`${styles.otp} ${invalid ? styles.otpInvalid : ""}`}>
      <input
        id="code"
        name="code"
        className={styles.otpInput}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        aria-label={label}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        value={value}
        readOnly={busy}
        aria-busy={busy}
        autoFocus={autoFocus}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, "").slice(0, 6))}
      />
      <div className={styles.otpBoxes} aria-hidden="true">
        {positions.map((position) => (
          <Fragment key={position}>
            {position === 3 && <span className={styles.otpSeparator} />}
            <span className={`${styles.otpBox} ${focused && position === activeIndex ? styles.otpBoxActive : ""}`}>
              {value[position] ??
                (focused && position === activeIndex ? <span className={styles.otpCaret} /> : null)}
            </span>
          </Fragment>
        ))}
      </div>
    </div>
  );
}
