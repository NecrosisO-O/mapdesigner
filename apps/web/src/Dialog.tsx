import { createPortal } from "react-dom";
import { useEffect, useRef, useState, type ReactNode } from "react";
export function Dialog(props: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const previousFocus = useRef(document.activeElement as HTMLElement | null);
  const close = useRef(props.onClose);
  close.current = props.onClose;
  useEffect(() => {
    const previous = previousFocus.current;
    const node = ref.current!;
    const focusable = () => [
      ...node.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]'
      )
    ];
    if (!node.contains(document.activeElement)) (focusable()[0] ?? node).focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close.current();
      }
      if (event.key !== "Tab") return;
      const items = focusable(),
        first = items[0],
        last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    node.addEventListener("keydown", onKey);
    return () => {
      node.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, []);
  return createPortal(
    <div className="dialog-backdrop">
      <div
        ref={ref}
        className={props.wide ? "dialog dialog-wide" : "dialog"}
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        tabIndex={-1}
      >
        <div className="dialog-heading">
          <h2>{props.title}</h2>
          <button aria-label="关闭对话框" onClick={props.onClose}>
            ×
          </button>
        </div>
        {props.children}
      </div>
    </div>,
    document.body
  );
}
interface Prompt {
  title: string;
  message?: string;
  initial?: string;
  confirm?: string;
  danger?: boolean;
  secret?: boolean;
}
export function useDialogPrompt() {
  const [prompt, setPrompt] = useState<Prompt | null>(null),
    [value, setValue] = useState("");
  const pending = useRef<((result: string | null) => void) | null>(null);
  function ask(input: Prompt): Promise<string | null> {
    if (pending.current) return Promise.resolve(null);
    setValue(input.initial ?? "");
    setPrompt(input);
    return new Promise((resolve) => {
      pending.current = resolve;
    });
  }
  function finish(result: string | null): void {
    pending.current?.(result);
    pending.current = null;
    setPrompt(null);
  }
  return {
    ask,
    open: !!prompt,
    dialog: prompt ? (
      <Dialog title={prompt.title} onClose={() => finish(null)}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            finish(prompt.initial === undefined ? "confirm" : value.trim());
          }}
        >
          {prompt.message && <p>{prompt.message}</p>}
          {prompt.initial !== undefined && (
            <label>
              {prompt.secret ? "访问令牌" : "名称"}
              <input
                autoFocus
                type={prompt.secret ? "password" : "text"}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                required
              />
            </label>
          )}
          <div className="dialog-actions">
            <button type="button" onClick={() => finish(null)}>
              取消
            </button>
            <button
              className={prompt.danger ? "danger-button" : "primary-button"}
              type="submit"
              disabled={prompt.initial !== undefined && !value.trim()}
            >
              {prompt.confirm ?? "确认"}
            </button>
          </div>
        </form>
      </Dialog>
    ) : null
  };
}
