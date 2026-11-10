import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Search } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { cn } from "../lib/utils";
import { Kbd } from "./kbd";

/**
 * A list of things to find and pick with the keyboard (issue #424): a field
 * to type in, results in groups, the arrows and Enter. It has shadcn's
 * Command parts and names, on our own keyboard handling rather than cmdk
 * (which brings Radix along): the page does the searching - on the server,
 * mostly - and gives the items; nothing is filtered here.
 *
 * In a dialog (`CommandDialog`, Songverse's Ctrl K search) or in the page
 * (a set's Add songs).
 */
interface CommandContext {
  listId: string;
  active: string | null;
  setActive: (id: string | null) => void;
  register: (id: string, select: CommandSelect) => () => void;
}
/** Picked with Enter (the key event, so Shift+Enter can mean something else) or a click. */
type CommandSelect = (event: ReactKeyboardEvent | ReactMouseEvent) => void;

const Context = createContext<CommandContext | null>(null);
function useCommand(part: string): CommandContext {
  const context = useContext(Context);
  if (!context) throw new Error(`<${part}> must be inside <Command>`);
  return context;
}

const ITEMS = '[data-slot="command-item"]:not([aria-disabled="true"])';

interface CommandProps extends ComponentProps<"div"> {
  /** When this changes, the first item is picked again: the results of a new search. */
  resetOn?: unknown;
}

function Command({ className, resetOn, onKeyDown, children, ...props }: CommandProps) {
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [active, setActive] = useState<string | null>(null);
  const selects = useRef(new Map<string, CommandSelect>());
  const items = useCallback(() => Array.from(root.current?.querySelectorAll<HTMLElement>(ITEMS) ?? []), []);

  // A new search: its first result.
  useEffect(() => setActive(items()[0]?.id ?? null), [resetOn, items]);
  // The item picked went away (or there was none yet): the first one.
  useEffect(() => {
    const now = items();
    if (!now.some((item) => item.id === active)) {
      const first = now[0]?.id ?? null;
      if (first !== active) setActive(first);
    }
  });
  useEffect(() => {
    if (active) document.getElementById(active)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const register = useCallback((id: string, select: CommandSelect) => {
    selects.current.set(id, select);
    return () => {
      if (selects.current.get(id) === select) selects.current.delete(id);
    };
  }, []);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    onKeyDown?.(event);
    // From the field only: a row's own button, or a menu it opened, keeps its keys.
    if (event.defaultPrevented || (event.target as HTMLElement).dataset.slot !== "command-input") return;
    const now = items();
    const at = now.findIndex((item) => item.id === active);
    const move = (to: number) => setActive(now[Math.max(0, Math.min(now.length - 1, to))]?.id ?? null);
    if (event.key === "ArrowDown") move(at + 1);
    else if (event.key === "ArrowUp") move(at - 1);
    else if (event.key === "Home" && event.ctrlKey) move(0);
    else if (event.key === "End" && event.ctrlKey) move(now.length - 1);
    // Not while a word is being composed (an input method's Enter picks the word).
    else if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      if (active) selects.current.get(active)?.(event);
    } else return;
    event.preventDefault();
  }

  const context = useMemo(() => ({ listId, active, setActive, register }), [listId, active, register]);
  return (
    <Context.Provider value={context}>
      <div ref={root} data-slot="command" className={cn("flex min-h-0 flex-col overflow-hidden text-popover-foreground", className)} onKeyDown={handleKeyDown} {...props}>
        {children}
      </div>
    </Context.Provider>
  );
}

interface CommandDialogProps extends DialogPrimitive.Root.Props {
  /** Said to screen readers; not shown. */
  title: string;
  /** What opens it: a `DialogPrimitive.Trigger`'s `render` element, with its children. */
  trigger?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** A Command over the page: near the top on a wide screen, nearly all of a phone's. */
function CommandDialog({ title, trigger, className, children, ...props }: CommandDialogProps) {
  return (
    <DialogPrimitive.Root data-slot="command-dialog" {...props}>
      {trigger}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/50 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <DialogPrimitive.Popup
          data-slot="command-dialog-content"
          className={cn(
            "fixed top-3 left-1/2 z-50 flex max-h-[calc(100dvh-1.5rem)] w-[calc(100%-1.5rem)] max-w-xl -translate-x-1/2 flex-col overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg outline-none sm:top-[12vh] sm:max-h-[70vh]",
            className,
          )}
        >
          <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
          {children}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
const CommandDialogTrigger = DialogPrimitive.Trigger;
const CommandDialogClose = DialogPrimitive.Close;

interface CommandInputProps extends ComponentProps<"input"> {
  /** `dialog`: tall and borderless, a rule under it. `field`: an input like the others, in a page. */
  variant?: "dialog" | "field";
  /** After the field, on its line: a switch, the dialog's Esc. */
  children?: ReactNode;
  wrapperClassName?: string;
}

/** Where one types. The arrows and Enter act on the list from here; the focus stays. */
function CommandInput({ className, wrapperClassName, variant = "dialog", children, ...props }: CommandInputProps) {
  const { listId, active } = useCommand("CommandInput");
  return (
    <div
      data-slot="command-input-wrapper"
      className={cn(
        "flex items-center gap-2",
        variant === "dialog" ? "border-b px-3" : "h-9 rounded-md border border-input bg-transparent px-2.5 shadow-xs focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/50",
        wrapperClassName,
      )}
    >
      <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <input
        data-slot="command-input"
        role="combobox"
        aria-expanded
        aria-autocomplete="list"
        aria-controls={listId}
        aria-activedescendant={active ?? undefined}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        className={cn(
          "min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
          variant === "dialog" ? "h-12 text-base" : "h-full text-sm",
          className,
        )}
        {...props}
      />
      {children}
    </div>
  );
}

function CommandList({ className, ...props }: ComponentProps<"div">) {
  const { listId } = useCommand("CommandList");
  return <div role="listbox" data-slot="command-list" className={cn("min-h-0 flex-1 overflow-y-auto p-2", className)} {...props} id={listId} />;
}

/** What it says when nothing was found. */
function CommandEmpty({ className, ...props }: ComponentProps<"p">) {
  return <p data-slot="command-empty" className={cn("px-2 py-6 text-center text-sm text-muted-foreground", className)} {...props} />;
}

interface CommandGroupProps extends Omit<ComponentProps<"div">, "title"> {
  /** Shown above the group's items. */
  heading: ReactNode;
  /** The group's name for screen readers, when it isn't the heading's own text. */
  label?: string;
}

function CommandGroup({ className, heading, label, children, ...props }: CommandGroupProps) {
  return (
    <div role="group" aria-label={label ?? (typeof heading === "string" ? heading : undefined)} data-slot="command-group" className={cn("mb-2 last:mb-0", className)} {...props}>
      <p data-slot="command-group-heading" aria-hidden className="px-2 py-1 text-xs font-medium text-muted-foreground">
        {heading}
      </p>
      {children}
    </div>
  );
}

interface CommandItemProps extends Omit<ComponentProps<"div">, "onSelect"> {
  onSelect?: CommandSelect;
  disabled?: boolean;
}

/** One result: picked by a click, or Enter while the arrows are on it. */
function CommandItem({ className, onSelect, disabled, id: givenId, onClick, onMouseMove, ...props }: CommandItemProps) {
  const { active, setActive, register } = useCommand("CommandItem");
  const ownId = useId();
  const id = givenId ?? ownId;
  const select = useRef(onSelect);
  select.current = onSelect;
  useEffect(() => (disabled ? undefined : register(id, (event) => select.current?.(event))), [id, disabled, register]);
  const selected = !disabled && active === id;
  return (
    <div
      id={id}
      role="option"
      aria-selected={selected}
      aria-disabled={disabled || undefined}
      data-slot="command-item"
      data-selected={selected || undefined}
      onMouseMove={(event) => {
        onMouseMove?.(event);
        if (!disabled && active !== id) setActive(id);
      }}
      onClick={(event) => {
        onClick?.(event);
        if (!disabled && !event.defaultPrevented) onSelect?.(event);
      }}
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm outline-none select-none aria-disabled:pointer-events-none aria-disabled:opacity-50 data-selected:bg-accent data-selected:text-accent-foreground [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function CommandSeparator({ className, ...props }: ComponentProps<"div">) {
  return <div role="separator" data-slot="command-separator" className={cn("-mx-2 my-1 h-px bg-border", className)} {...props} />;
}

/** A key that does it, at the end of an item or on the trigger. */
function CommandShortcut({ className, ...props }: ComponentProps<typeof Kbd>) {
  return <Kbd data-slot="command-shortcut" className={cn("ml-auto", className)} {...props} />;
}

export {
  Command,
  CommandDialog,
  CommandDialogClose,
  CommandDialogTrigger,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
  type CommandSelect,
};
