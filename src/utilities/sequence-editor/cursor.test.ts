import { rust } from '@codemirror/lang-rust';
import { ensureSyntaxTree, LRLanguage } from '@codemirror/language';
import { EditorSelection, EditorState } from '@codemirror/state';
import { FprimeRustCommandInfoMapper, SeqNCommandInfoMapper, seqnParser } from '@nasa-jpl/plandev-sequence-languages';
import { describe, expect, it } from 'vitest';
import { getInspectedNode } from './cursor';

const mapper = new FprimeRustCommandInfoMapper();

function commandAt(doc: string, cursor: number) {
  const state = EditorState.create({ doc, extensions: rust(), selection: EditorSelection.cursor(cursor) });
  ensureSyntaxTree(state, doc.length, 1000);
  const call = mapper.getContainingCommand(getInspectedNode(state, mapper));
  const name = call && mapper.getNameNode(call);
  return name ? doc.slice(name.from, name.to) : null;
}

describe('getInspectedNode', () => {
  const doc = [
    'fn main() {',
    '    A.b.FIRST(1); A.b.SECOND(2);',
    '    A.b.OUTER(',
    '        A.b.INNER(3),',
    '        4,',
    '    );',
    '    let x = 5;',
    '}',
  ].join('\n');

  it('uses the cursor, not the start of its line', () => {
    expect(commandAt(doc, doc.indexOf('SECOND') + 2)).toBe('A.b.SECOND');
    expect(commandAt(doc, doc.indexOf('(2)') + 1)).toBe('A.b.SECOND');
    expect(commandAt(doc, doc.indexOf('FIRST'))).toBe('A.b.FIRST');
  });

  it('picks the innermost call, and the enclosing call from its other arguments', () => {
    expect(commandAt(doc, doc.indexOf('INNER') + 1)).toBe('A.b.INNER');
    expect(commandAt(doc, doc.indexOf('4,'))).toBe('A.b.OUTER');
    expect(commandAt(doc, doc.indexOf(');\n    let'))).toBe('A.b.OUTER');
  });

  it('counts a cursor right after a call, or in its line indentation, as on that call', () => {
    expect(commandAt(doc, doc.indexOf('(1)') + 3)).toBe('A.b.FIRST');
    expect(commandAt(doc, doc.indexOf('    A.b.FIRST') + 1)).toBe('A.b.FIRST');
  });

  it('finds nothing on lines without calls', () => {
    expect(commandAt(doc, doc.indexOf('let x') + 4)).toBeNull();
  });
});

describe('getInspectedNode in a line-oriented language (SeqN)', () => {
  const seqn = LRLanguage.define({ parser: seqnParser });
  const seqnMapper = new SeqNCommandInfoMapper();
  const doc = 'C FIRST 1 2\n  C SECOND "x"   \nC THIRD\n';
  const at = (cursor: number) => {
    const state = EditorState.create({ doc, extensions: seqn, selection: EditorSelection.cursor(cursor) });
    ensureSyntaxTree(state, doc.length, 1000);
    const command = seqnMapper.getContainingCommand(getInspectedNode(state, seqnMapper));
    const name = command && seqnMapper.getNameNode(command);
    return name ? doc.slice(name.from, name.to) : null;
  };

  it('keeps line semantics: indentation, trailing space and arguments select that line', () => {
    expect(at(doc.indexOf('2'))).toBe('FIRST');
    expect(at(doc.indexOf('  C SECOND') + 1)).toBe('SECOND');
    expect(at(doc.indexOf('"x"   ') + 5)).toBe('SECOND');
    expect(at(doc.indexOf('THIRD') + 2)).toBe('THIRD');
  });
});
