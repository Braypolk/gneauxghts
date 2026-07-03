this.#unlisteners = [];
return () => this.#vaultChangedListeners.delete(listener);
what does the # mean before the var? Is it to send it to a rust function?

this.#unlisteners.push(
      await listen<VaultInfo>('vault-changed', (event) => {
        this.vaultInfo = event.payload;
        for (const listener of this.#vaultChangedListeners) {
          try {
            listener(event.payload);
          } catch {
            // continue dispatching
          }
        }
      })
    );

why does this continue dispatching instead of catching and doing something with the error


export class WorkspaceStore
is doing a class like this for state just like a normal class? I'm still confused how svelte handles global state in runes mode


what is the correct way to handle shortcuts





<SlashMenu menu={paneRuntimes[PRIMARY_PANE_ID].ui.slashMenu} boundsElement={paneRuntimes[PRIMARY_PANE_ID].refs.paneCard} />
<SlashMenu menu={paneRuntimes[SECONDARY_PANE_ID].ui.slashMenu} boundsElement={paneRuntimes[SECONDARY_PANE_ID].refs.paneCard} />
i dont think i want slash menu to be active on both. there should only be one menu and then the position just attatches to the pane/slash location. same with WikilinkAutocomplete. 

$effect(() => trackPaneSelection(PRIMARY_PANE_ID));
$effect(() => trackPaneSelection(SECONDARY_PANE_ID));
like why do an effect for both? couldn't you just trackpaneselection and pass the id back up instead of doing multiple $effects?
again, pane should be the truth and then events bubble back up, same with this
void paneControllers[PRIMARY_PANE_ID].editorLifecycleController.destroyEditor();
void paneControllers[SECONDARY_PANE_ID].editorLifecycleController.destroyEditor();

definlety need to do some rework and understanding of the current pane architecture. I think it is currently more top down approach, but everything really originates from the current pane. things that use PRIMARY/SECONDARY_PANE_ID may not be the best way to do things. would it be better/cleaner architecture to pass current pane id. basically having a structure that doesn't rely on hardcoded pane numbers. also, a pane shouldn't be just related to editor. the pane should be a shell that different pane types can be inserted into (editor, chat, etc.)

<RelatedPanel.../>
seems like there are quite a few elements duplicated for different screen sizes. is this the best way? i feel like there is a much cleaner way this could be done




let mounted = true;
...
if (!mounted || !paneRuntimes[PRIMARY_PANE_ID].refs.editorRoot) return;


since mounted is immeditley set to true, would the var ever be false in this function?