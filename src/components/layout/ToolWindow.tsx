import type { PropsWithChildren } from "react";

type ToolWindowProps = PropsWithChildren<{
  title: string;
  caption?: string;
  ariaLabel?: string;
  visible?: boolean;
  className?: string;
}>;

export function ToolWindow({
  title,
  caption,
  ariaLabel,
  visible = true,
  className,
  children
}: ToolWindowProps) {
  return (
    <section
      aria-label={ariaLabel ?? title}
      className={className}
      hidden={!visible}
    >
      <header className="tool-window__header">
        <div className="tool-window__title-group">
          {caption ? <span className="tool-window__caption">{caption}</span> : null}
          <h2>{title}</h2>
        </div>
        <div className="tool-window__actions" aria-hidden="true">
          <span className="tool-window__action-dot" />
          <span className="tool-window__action-dot" />
          <span className="tool-window__action-dot" />
        </div>
      </header>
      <div className="tool-window__body">{children}</div>
    </section>
  );
}
