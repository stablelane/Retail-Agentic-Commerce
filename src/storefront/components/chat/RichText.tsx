import { Fragment, type ReactNode } from "react";

/** `**bold**` spans as React nodes; everything else stays plain text (no HTML, no links). */
function inline(text: string, keyPrefix: string): ReactNode[] {
  return text.split(/(\*\*[^*\n]+\*\*)/g).map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    return <Fragment key={key}>{part}</Fragment>;
  });
}

const BULLET = /^\s*[-*•]\s+/;
const NUMBERED = /^\s*\d+[.)]\s+/;

/** Minimal markdown for streamed assistant prose: paragraphs, line breaks, bold and lists. */
export function RichText({ text }: { text: string }) {
  const blocks = text
    .trim()
    .split(/\n{2,}/)
    .filter((block) => block.trim());

  return (
    <div className="flex flex-col gap-3 text-small leading-normal text-text">
      {blocks.map((block, blockIndex) => {
        const lines = block.split("\n").filter((line) => line.trim());
        const key = `b${blockIndex}`;
        if (lines.length > 0 && lines.every((line) => BULLET.test(line))) {
          return (
            <ul key={key} className="list-disc space-y-1 pl-5">
              {lines.map((line, index) => (
                <li key={index}>{inline(line.replace(BULLET, ""), `${key}-${index}`)}</li>
              ))}
            </ul>
          );
        }
        if (lines.length > 0 && lines.every((line) => NUMBERED.test(line))) {
          return (
            <ol key={key} className="list-decimal space-y-1 pl-5">
              {lines.map((line, index) => (
                <li key={index}>{inline(line.replace(NUMBERED, ""), `${key}-${index}`)}</li>
              ))}
            </ol>
          );
        }
        return (
          <p key={key}>
            {lines.map((line, index) => (
              <Fragment key={index}>
                {index > 0 ? <br /> : null}
                {inline(line, `${key}-${index}`)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
