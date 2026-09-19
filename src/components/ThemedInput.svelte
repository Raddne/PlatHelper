<script lang="ts">
  export let value: string | number = "";
  export let type = "text";
  export let id = "";
  export let placeholder = "";
  export let disabled = false;
  export let required = false;
  export let autocomplete: "" | "email" | "current-password" | "off" | "on" = "";
  export let min: string | number | null = null;
  export let max: string | number | null = null;
  export let className = "";
  export let onInput: (() => void) | null = null;
  export let onFocus: (() => void) | null = null;
  export let onBlur: (() => void) | null = null;
  /** Underlying input element, for focus control. */
  export let el: HTMLInputElement | null = null;
  /** Marks this input as the view's Ctrl+F search target. */
  export let searchFocusTarget = false;
  /** Clamps to min/max by writing el; a bound value alone leaves the typed digits on screen. */
  export let clampToRange = false;
  /** Clamp on blur instead of on every keystroke, so typing "15" past a lower
   *  max isn't fought character-by-character while the field is still active. */
  export let clampOnBlur = false;

  function clampNow(): void {
    if (!clampToRange || !el || (min === null && max === null)) return;
    const typed = el.value;
    if (typed === "") return;
    const parsed = Number(typed);
    if (!Number.isFinite(parsed)) return;
    let clamped = Math.trunc(parsed);
    if (min !== null) clamped = Math.max(Number(min), clamped);
    if (max !== null) clamped = Math.min(Number(max), clamped);
    if (String(clamped) === typed) return;
    el.value = String(clamped);
    value = String(clamped);
  }

  function clampTyped(): void {
    if (!clampOnBlur) clampNow();
  }

  function handleBlur(): void {
    if (clampOnBlur) clampNow();
    onBlur?.();
  }
</script>

<input
  bind:this={el}
  {type}
  id={id || undefined}
  bind:value
  {placeholder}
  {disabled}
  {required}
  autocomplete={autocomplete || undefined}
  min={min ?? undefined}
  max={max ?? undefined}
  data-search-focus={searchFocusTarget ? "" : undefined}
  class="rounded-[var(--radius-md)] border border-[color:var(--ui-control-border)]
         bg-[var(--ui-control-bg)] px-2.5 py-2 text-sm text-text-primary outline-none
         transition-[border-color,box-shadow,background] duration-150
         placeholder:text-text-muted focus:border-accent-dim
         focus:shadow-[0_0_0_2px_rgba(212,168,67,0.12)]
         disabled:cursor-not-allowed disabled:opacity-50
         [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none
         [&::-webkit-outer-spin-button]:appearance-none {className}"
  on:input={() => {
    clampTyped();
    onInput?.();
  }}
  on:focus={() => onFocus?.()}
  on:blur={handleBlur}
/>
