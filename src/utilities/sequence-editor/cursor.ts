import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import type { CommandInfoMapper } from '@nasa-jpl/plandev-sequence-languages';

/**
 * The syntax node the command panel inspects: the one at the cursor (either side of it, so a cursor
 * right after `)` still counts as in the call). When neither is in a command, the first node of the
 * cursor's line: line-oriented languages (SeqN, F Prime .seq) treat a cursor in a line's indentation
 * or past its end as being on that line's command.
 */
export function getInspectedNode(state: EditorState, mapper: CommandInfoMapper | null): SyntaxNode {
  const tree = syntaxTree(state);
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  const lineStart = tree.resolveInner(line.from + (line.text.length - line.text.trimStart().length), 1);
  // In the indentation, the previous line's node (which may end with this whitespace) is not meant.
  if (head <= lineStart.from) {
    return lineStart;
  }
  for (const side of [1, -1] as const) {
    const node = tree.resolveInner(head, side);
    if (mapper?.getContainingCommand(node)) {
      return node;
    }
  }
  return lineStart;
}
