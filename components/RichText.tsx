import { Fragment, type ReactNode } from "react";

// Offer text formatting: keeps the line breaks as typed, **bold** and _italic_.

/** Text without the ** and _ marks (phone notifications show plain text). */
export function plainText(text: string) {
  return String(text ?? "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/(^|[\s(])_(\S(?:.*?\S)?)_(?=$|[\s).,!?:;])/g, "$1$2");
}

/** WhatsApp uses *bold* and _italic_. */
export function whatsAppText(text: string) {
  return String(text ?? "").replace(/\*\*(.+?)\*\*/g, "*$1*");
}

function inline(line: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|(^|[\s(])_(\S(?:.*?\S)?)_(?=$|[\s).,!?:;])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(line))) {
    if (m[1] !== undefined) {
      out.push(line.slice(last, m.index));
      out.push(<strong key={`${key}-${i++}`} className="font-bold text-black">{m[1]}</strong>);
    } else {
      out.push(line.slice(last, m.index) + m[2]);
      out.push(<em key={`${key}-${i++}`}>{m[3]}</em>);
    }
    last = m.index + m[0].length;
  }
  out.push(line.slice(last));
  return out;
}

export function RichText({ text, className = "" }: { text: string; className?: string }) {
  const lines = String(text ?? "").split("\n");
  return (
    <span className={className}>
      {lines.map((l, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          {inline(l, String(i))}
        </Fragment>
      ))}
    </span>
  );
}
