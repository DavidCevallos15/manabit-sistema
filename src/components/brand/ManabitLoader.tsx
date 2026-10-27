import { EMBLEM_BASE, EMBLEM_BIT } from "./manabit-paths";
import "./manabit-loader.css";

type Props = {
  /** Lado en px. Por defecto 48. */
  size?: number;
  /** Texto para lectores de pantalla. */
  label?: string;
  className?: string;
};

/**
 * Loader de manabit: la M se barre de izquierda a derecha, el bit late y la M sale. Bucle de 1,6 s.
 * Tinta = currentColor · bit = --manabit-bit. Con prefers-reduced-motion solo late el bit.
 */
export function ManabitLoader({
  size = 48,
  label = "Cargando",
  className,
}: Props) {
  return (
    <span
      role="status"
      aria-label={label}
      className={className}
      style={{ display: "inline-block", width: size, height: size }}
    >
      <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden="true">
        <path
          fillRule="evenodd"
          d={EMBLEM_BASE}
          fill="currentColor"
          opacity={0.15}
        />
        <path
          className="mnb-body"
          fillRule="evenodd"
          d={EMBLEM_BASE}
          fill="currentColor"
        />
        <path
          className="mnb-bit"
          d={EMBLEM_BIT}
          fill="var(--manabit-bit, #D4573F)"
        />
      </svg>
    </span>
  );
}
