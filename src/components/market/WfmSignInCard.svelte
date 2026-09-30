<script lang="ts">
  import ThemedInput from "../ThemedInput.svelte";
  import { tr, type MessageKey } from "../../lib/i18n.js";
  import { invoke, send } from "../../lib/ipc.js";
  import { refreshWfmPresence } from "../../lib/wfm/presence.js";
  import { marketSession } from "../../stores/market.js";

  // The one warframe.market sign-in form. Market, Live Scraper and Messages all
  // carry it, so the account stays reachable whichever of them is hidden. The
  // credentials only ever travel to main; nothing here keeps them past a success.
  let { onSignedIn }: { onSignedIn?: () => void | Promise<void> } = $props();

  let email = $state("");
  let password = $state("");
  let loginErrorKey = $state<MessageKey | null>(null);
  let loginErrorText = $state("");
  let loginLoading = $state(false);

  // The sentence stays one key so a translator can move the link; omitting the
  // param leaves "{link}" in place as the split point.
  const steamHintParts = $derived($tr("market.signInSteamHint").split("{link}"));

  async function login(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    loginErrorKey = null;
    loginErrorText = "";
    loginLoading = true;
    try {
      const result = await invoke("wfmSignIn", { email, password });
      if (!result.loggedIn) {
        if (result.error) loginErrorText = result.error;
        else loginErrorKey = "market.signInFailed";
      } else {
        marketSession.set(result);
        password = "";
        // Sign-out cleared the previous account, and the pill is on every tab.
        await refreshWfmPresence();
        await onSignedIn?.();
      }
    } catch (error) {
      loginErrorText = (error as Error).message;
    } finally {
      loginLoading = false;
    }
  }
</script>

<div class="w-[min(560px,100%)] rounded-xl border border-border bg-bg-surface p-4" data-wfm-sign-in>
  <div class="mb-2.5 text-accent">
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" class="h-10 w-10">
      <circle cx="24" cy="14" r="8" />
      <path d="M8 40c0-8.837 7.163-16 16-16s16 7.163 16 16" />
    </svg>
  </div>
  <h2 class="m-0 font-display text-2xl font-bold">{$tr("market.wfmTitle")}</h2>
  <p class="mt-1.5 mb-3.5 text-sm text-text-secondary">
    <strong>{$tr("market.signInHint")}</strong><br />
    {steamHintParts[0]}<button
      type="button"
      class="link-btn"
      onclick={() => send("open-external", "https://warframe.market/profile/settings#password")}
      >{$tr("market.wfmAccountSettings")}</button
    >{steamHintParts[1] ?? ""}
  </p>
  <form autocomplete="on" onsubmit={login}>
    <div class="grid gap-1 mb-2">
      <label for="market-email" class="text-sm font-medium text-text-secondary"
        >{$tr("market.emailLabel")}</label
      >
      <ThemedInput
        id="market-email"
        type="email"
        bind:value={email}
        placeholder="you@example.com"
        autocomplete="email"
        required
        className="w-full"
      />
    </div>
    <div class="grid gap-1 mb-2">
      <label for="market-password" class="text-sm font-medium text-text-secondary"
        >{$tr("market.passwordLabel")}</label
      >
      <ThemedInput
        id="market-password"
        type="password"
        bind:value={password}
        placeholder="........"
        autocomplete="current-password"
        required
        className="w-full"
      />
    </div>
    {#if loginErrorKey || loginErrorText}
      <div class="text-danger">
        {loginErrorKey ? $tr(loginErrorKey) : loginErrorText}
      </div>
    {/if}
    <button type="submit" class="btn-primary mt-1 w-full" disabled={loginLoading}>
      {loginLoading ? $tr("market.signingIn") : $tr("market.signIn")}
    </button>
  </form>
</div>
