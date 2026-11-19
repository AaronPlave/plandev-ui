import { EditorState } from '@codemirror/state';
import type { CommandDictionary, FswCommand } from '@nasa-jpl/plandev-ampcs';
import type { CommandInfoMapper } from '@nasa-jpl/plandev-sequence-languages';
import { describe, expect, it } from 'vitest';
import { diffCommandDictionaries, diffEnums, planCommandInsert, searchMissionReference } from './mission-reference';

function command(stem: string, args: FswCommand['arguments'] = [], description = ''): FswCommand {
  return { argumentMap: {}, arguments: args, description, stem, type: 'fsw_command' };
}

const opArg = {
  arg_type: 'enum',
  bit_length: 8,
  default_value: null,
  description: '',
  enum_name: 'Op',
  name: 'op',
  range: null,
} as const;
const valArg = {
  arg_type: 'float',
  bit_length: 32,
  default_value: null,
  description: '',
  name: 'val',
  range: null,
  units: '',
} as const;

function dictionary(commands: FswCommand[], ops: string[]): CommandDictionary {
  const values = ops.map((symbol, numeric) => ({ numeric, symbol }));
  return {
    enumMap: { Op: { name: 'Op', values } },
    enums: [{ name: 'Op', values }],
    fswCommandMap: Object.fromEntries(commands.map(c => [c.stem, c])),
    fswCommands: commands,
    header: { mission_name: 'M', schema_version: '', spacecraft_ids: [], version: '1' },
    hwCommandMap: {},
    hwCommands: [],
    id: 'd',
    path: null,
  };
}

describe('searchMissionReference', () => {
  const commandDictionary = dictionary(
    [command('DO_MATH', [valArg, opArg], 'Do a math operation'), command('NO_OP', [], 'mentions math')],
    ['ADD', 'SUB'],
  );
  const context = { channelDictionary: null, commandDictionary, parameterDictionaries: [] };

  it('matches names before arguments, enum values and descriptions', () => {
    expect(searchMissionReference(context, 'command', 'math').map(e => [e.name, e.matchedIn])).toEqual([
      ['DO_MATH', null],
      ['NO_OP', 'description'],
    ]);
    expect(searchMissionReference(context, 'command', 'sub')[0].matchedIn).toBe('enum value SUB (op)');
    expect(searchMissionReference(context, 'command', 'VAL')[0].matchedIn).toBe('argument "val"');
    expect(searchMissionReference(context, 'telemetry', '')).toEqual([]);
  });
});

describe('planCommandInsert', () => {
  const lineMapper = { getContainingCommand: () => null } as unknown as CommandInfoMapper;

  it('replaces a blank line, else adds a line after the cursor line with its indentation', () => {
    const state = EditorState.create({ doc: '  C A\n\nC B' });
    expect(planCommandInsert(state, lineMapper, 'C X', 6)).toMatchObject({
      changes: { from: 6, insert: 'C X', to: 6 },
    });
    expect(planCommandInsert(state, lineMapper, 'C X', 1)).toMatchObject({
      changes: { from: 5, insert: '\n  C X' },
      selection: { anchor: 11 },
    });
  });

  it('refuses where the language finds no safe place', () => {
    const mapper = { getCommandInsertPosition: () => null } as unknown as CommandInfoMapper;
    expect(typeof planCommandInsert(EditorState.create({ doc: 'use x;' }), mapper, 'X();', 0)).toBe('string');
  });
});

describe('diffCommandDictionaries', () => {
  it('separates signature changes from description-only changes', () => {
    const before = dictionary(
      [command('DO_MATH', [valArg, opArg]), command('GONE'), command('DOC', [], 'old')],
      ['ADD', 'SUB'],
    );
    const after = dictionary(
      [command('DO_MATH', [{ ...valArg, bit_length: 64 }, opArg]), command('NEW'), command('DOC', [], 'new')],
      ['ADD', 'MUL'],
    );
    expect(diffCommandDictionaries(before, after).map(c => [c.kind, c.stem, c.details])).toEqual([
      ['removed', 'GONE', []],
      [
        'signature',
        'DO_MATH',
        [
          'argument "val": float 32 bits → float 64 bits',
          'argument "op": enum values removed: SUB',
          'argument "op": enum values added: MUL',
        ],
      ],
      ['added', 'NEW', []],
      ['description', 'DOC', []],
    ]);
    expect(diffEnums(before, after)).toEqual([{ added: ['MUL'], name: 'Op', removed: ['SUB'] }]);
  });
});
