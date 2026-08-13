import type { ReactNode } from "react";

/**
 * Shared long-form-content shell for the public legal/trust/docs pages —
 * these are the only pages in the marketing site that need styled
 * headings/paragraphs/lists inside a single content blob, so the
 * heading/paragraph styling lives once here instead of being repeated
 * with utility classes on every <h2>/<p> across ~10 page files.
 */
export function DocPage({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-3xl px-6 py-20">
      {eyebrow && (
        <p className="text-sm font-medium text-muted-foreground">{eyebrow}</p>
      )}
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
        {title}
      </h1>
      {description && (
        <p className="mt-4 text-lg text-muted-foreground">{description}</p>
      )}
      <div
        className="mt-10 space-y-5 text-[15px] leading-relaxed text-foreground/90
          [&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-foreground [&_h2]:first:mt-0
          [&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-foreground
          [&_p]:text-foreground/90
          [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5 [&_ul]:text-foreground/90
          [&_li]:marker:text-muted-foreground
          [&_strong]:font-semibold [&_strong]:text-foreground
          [&_code]:rounded [&_code]:border [&_code]:border-border [&_code]:bg-surface-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-[13px]
          [&_a]:text-brand [&_a]:underline [&_a]:underline-offset-2"
      >
        {children}
      </div>
    </div>
  );
}
