import { encode } from "uqr";

/** Modules of light margin inside the SVG; the white card around it adds the rest of the quiet zone. */
const margin = 2;

/**
 * QR code drawn as SVG on the server, so showing the authenticator secret
 * needs no client-side JavaScript. Dark modules on each row are merged into runs.
 */
export function QrCode({ value, label }: { value: string; label: string }) {
  const { data, size } = encode(value, { ecc: "M", border: 0 });
  const total = size + margin * 2;

  let path = "";
  data.forEach((row, y) => {
    let x = 0;
    while (x < size) {
      if (!row[x]) {
        x++;
        continue;
      }
      const start = x;
      while (x < size && row[x]) {
        x++;
      }
      path += `M${start + margin} ${y + margin}h${x - start}v1h-${x - start}z`;
    }
  });

  return (
    <svg viewBox={`0 0 ${total} ${total}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={total} height={total} fill="#ffffff" />
      <path d={path} fill="#0a0a0a" />
    </svg>
  );
}
