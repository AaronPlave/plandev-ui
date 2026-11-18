import { indentService, LRLanguage } from '@codemirror/language';
import { StateEffect, StateField, type StateEffectType } from '@codemirror/state';
import { linter } from '@codemirror/lint';
import { hoverTooltip, ViewPlugin } from '@codemirror/view';
import type { CodeHelpStatus, CreateTooltip, PhoenixResources } from '@nasa-jpl/plandev-sequence-languages';
import { EditorView } from 'codemirror';
import StringTooltip from '../../components/sequencing/StringTooltip.svelte';

const createTooltip: CreateTooltip = (text: string[], from: number, to?: number) => {
  return {
    above: true,
    create() {
      const dom = document.createElement('div');
      new StringTooltip({ props: { messages: text }, target: dom });
      return { dom };
    },
    end: to,
    pos: from,
  };
};
/** Language intelligence status an adaptation reports (e.g. a language server starting); null: none. */
export const setCodeHelpStatus = StateEffect.define<CodeHelpStatus | null>();
export const codeHelpStatusField = StateField.define<CodeHelpStatus | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setCodeHelpStatus)) {
        return effect.value;
      }
    }
    return value;
  },
});

export const phoenixResources: PhoenixResources = {
  EditorView,
  LRLanguage,
  ViewPlugin,
  createTooltip,
  hoverTooltip,
  indentService,
  linter,
  // Adaptations only report statuses; the editor itself also clears it (null) when it reconfigures.
  setCodeHelpStatus: setCodeHelpStatus as StateEffectType<CodeHelpStatus>,
};
