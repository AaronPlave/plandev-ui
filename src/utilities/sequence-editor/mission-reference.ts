import { getIndentation, indentString, syntaxTree } from '@codemirror/language';
import type { EditorState, TransactionSpec } from '@codemirror/state';
import type {
  CommandDictionary,
  EnumMap,
  FswCommand,
  FswCommandArgument,
  HwCommand,
  Parameter,
  Telemetry,
} from '@nasa-jpl/plandev-ampcs';
import type { CommandInfoMapper, PhoenixContext } from '@nasa-jpl/plandev-sequence-languages';

export type MissionReferenceKind = 'command' | 'parameter' | 'telemetry';

export type MissionReferenceEntry = {
  description: string;
  kind: MissionReferenceKind;
  /** Where the query matched when it was not the name, e.g. `argument "op"` or `enum value ADD`. */
  matchedIn: string | null;
  name: string;
};

/** Symbols an enum argument accepts: its own range, else its enum's values. */
export function enumSymbols(arg: FswCommandArgument, enumMap: EnumMap): string[] {
  if (arg.arg_type !== 'enum') {
    return [];
  }
  return arg.range ?? enumMap[arg.enum_name]?.values.map(value => value.symbol) ?? [];
}

/** The leaf arguments of a command, with repeat groups flattened. */
function flatArguments(args: FswCommandArgument[]): FswCommandArgument[] {
  return args.flatMap(arg =>
    arg.arg_type === 'repeat' ? [arg, ...flatArguments(arg.repeat?.arguments ?? [])] : [arg],
  );
}

function commandMatch(command: FswCommand | HwCommand, query: string, enumMap: EnumMap): string | null | undefined {
  if (command.stem.toLowerCase().includes(query)) {
    return null;
  }
  for (const arg of command.type === 'fsw_command' ? flatArguments(command.arguments) : []) {
    if (arg.name.toLowerCase().includes(query)) {
      return `argument "${arg.name}"`;
    }
    const symbol = enumSymbols(arg, enumMap).find(s => s.toLowerCase().includes(query));
    if (symbol !== undefined) {
      return `enum value ${symbol} (${arg.name})`;
    }
  }
  if (command.description?.toLowerCase().includes(query)) {
    return 'description';
  }
  return undefined;
}

function itemMatch(name: string, description: string, query: string): string | null | undefined {
  if (name.toLowerCase().includes(query)) {
    return null;
  }
  return description.toLowerCase().includes(query) ? 'description' : undefined;
}

/**
 * Everything in the parcel's dictionaries matching `query` in a name, description, argument name or
 * enum value — name matches first. An empty query lists every entry of `kind`.
 */
export function searchMissionReference(
  context: Pick<PhoenixContext, 'channelDictionary' | 'commandDictionary' | 'parameterDictionaries'>,
  kind: MissionReferenceKind,
  rawQuery: string,
): MissionReferenceEntry[] {
  const query = rawQuery.trim().toLowerCase();
  const out: MissionReferenceEntry[] = [];
  const add = (name: string, description: string, matchedIn: string | null | undefined) => {
    if (matchedIn !== undefined) {
      out.push({ description, kind, matchedIn, name });
    }
  };
  if (kind === 'command' && context.commandDictionary) {
    const { enumMap, fswCommands, hwCommands } = context.commandDictionary;
    for (const command of [...fswCommands, ...hwCommands]) {
      add(command.stem, command.description ?? '', commandMatch(command, query, enumMap));
    }
  } else if (kind === 'telemetry' && context.channelDictionary) {
    for (const channel of context.channelDictionary.telemetries) {
      add(
        channel.abbreviation,
        channel.description ?? '',
        itemMatch(channel.abbreviation, channel.description ?? '', query),
      );
    }
  } else if (kind === 'parameter') {
    for (const parameter of context.parameterDictionaries.flatMap(d => d.params)) {
      add(
        parameter.param_name,
        parameter.description ?? '',
        itemMatch(parameter.param_name, parameter.description ?? '', query),
      );
    }
  }
  // Stable: name matches keep dictionary order ahead of the rest.
  return [...out.filter(e => e.matchedIn === null), ...out.filter(e => e.matchedIn !== null)];
}

export function findTelemetry(context: Pick<PhoenixContext, 'channelDictionary'>, name: string): Telemetry | null {
  return context.channelDictionary?.telemetryMap[name] ?? null;
}

export function findParameter(context: Pick<PhoenixContext, 'parameterDictionaries'>, name: string): Parameter | null {
  return context.parameterDictionaries.map(d => d.paramMap[name]).find(Boolean) ?? null;
}

/**
 * The editor change that writes `text` as a step of its own near `pos`, or an explanation of why
 * there is no safe place. A blank line is replaced; otherwise the step goes on a new line after the
 * command (or line) at `pos`, indented as the language would indent it.
 */
export function planCommandInsert(
  state: EditorState,
  mapper: CommandInfoMapper,
  text: string,
  pos: number,
): TransactionSpec | string {
  let at = pos;
  if (mapper.getCommandInsertPosition) {
    const found = mapper.getCommandInsertPosition(state, pos);
    if (found === null) {
      return 'No safe place for a command at the cursor. Put the cursor where a step can go, e.g. inside the sequence body.';
    }
    at = found;
  } else {
    at = mapper.getContainingCommand(syntaxTree(state).resolveInner(pos, -1))?.to ?? pos;
  }
  const line = state.doc.lineAt(at);
  if (line.text.trim() === '') {
    const indent = indentString(state, getIndentation(state, line.from) ?? 0);
    return {
      changes: { from: line.from, insert: indent + text, to: line.to },
      selection: { anchor: line.from + indent.length + text.length },
    };
  }
  const indent = line.text.match(/^\s*/)?.[0] ?? '';
  const insert = `\n${indent}${text}`;
  return { changes: { from: line.to, insert }, selection: { anchor: line.to + insert.length } };
}

export type CommandChange = {
  after: FswCommand | HwCommand | null;
  before: FswCommand | HwCommand | null;
  /** What changed, e.g. `argument "op": enum values removed: SUB`. Empty for added/removed commands. */
  details: string[];
  kind: 'added' | 'description' | 'removed' | 'signature';
  stem: string;
};

/** One-line description of an argument's interface, as compared between dictionaries. */
export function argumentSignature(arg: FswCommandArgument, enumMap: EnumMap): string {
  const parts: string[] = [arg.arg_type];
  if ('bit_length' in arg && arg.bit_length !== null) {
    parts.push(`${arg.bit_length} bits`);
  }
  if (arg.arg_type === 'enum') {
    parts.push(arg.enum_name);
  }
  if ('range' in arg && arg.range && !Array.isArray(arg.range)) {
    parts.push(`${arg.range.min}…${arg.range.max}`);
  }
  if ('units' in arg && arg.units) {
    parts.push(arg.units);
  }
  if (arg.arg_type === 'var_string' && arg.max_bit_length !== null) {
    parts.push(`max ${arg.max_bit_length} bits`);
  }
  if (arg.arg_type === 'repeat') {
    parts.push(`[${(arg.repeat?.arguments ?? []).map(a => `${a.name}: ${argumentSignature(a, enumMap)}`).join(', ')}]`);
    parts.push(`${arg.repeat?.min ?? 0}…${arg.repeat?.max ?? '∞'}`);
  }
  return parts.join(' ');
}

function signatureChanges(before: FswCommand, after: FswCommand, beforeEnums: EnumMap, afterEnums: EnumMap): string[] {
  const details: string[] = [];
  const count = Math.max(before.arguments.length, after.arguments.length);
  for (let i = 0; i < count; i++) {
    const a = before.arguments[i];
    const b = after.arguments[i];
    if (!a) {
      details.push(`argument ${i + 1} "${b.name}" added (${argumentSignature(b, afterEnums)})`);
      continue;
    }
    if (!b) {
      details.push(`argument ${i + 1} "${a.name}" removed`);
      continue;
    }
    if (a.name !== b.name) {
      details.push(`argument ${i + 1} renamed "${a.name}" → "${b.name}"`);
    }
    const sa = argumentSignature(a, beforeEnums);
    const sb = argumentSignature(b, afterEnums);
    if (sa !== sb) {
      details.push(`argument "${b.name}": ${sa} → ${sb}`);
    }
    const ea = enumSymbols(a, beforeEnums);
    const eb = enumSymbols(b, afterEnums);
    const removed = ea.filter(s => !eb.includes(s));
    const added = eb.filter(s => !ea.includes(s));
    if (removed.length) {
      details.push(`argument "${b.name}": enum values removed: ${removed.join(', ')}`);
    }
    if (added.length) {
      details.push(`argument "${b.name}": enum values added: ${added.join(', ')}`);
    }
  }
  return details;
}

/**
 * Command-level differences between two command dictionaries. Signature changes (arguments, types,
 * ranges, enum values) are kept apart from description-only changes, which cannot break a sequence.
 */
export function diffCommandDictionaries(before: CommandDictionary, after: CommandDictionary): CommandChange[] {
  const index = (d: CommandDictionary) =>
    new Map<string, FswCommand | HwCommand>([...d.fswCommands, ...d.hwCommands].map(c => [c.stem, c]));
  const a = index(before);
  const b = index(after);
  const changes: CommandChange[] = [];
  for (const [stem, old] of a) {
    const next = b.get(stem);
    if (!next) {
      changes.push({ after: null, before: old, details: [], kind: 'removed', stem });
      continue;
    }
    const details: string[] = [];
    if (old.type !== next.type) {
      details.push(`${old.type} → ${next.type}`);
    } else if (old.type === 'fsw_command' && next.type === 'fsw_command') {
      details.push(...signatureChanges(old, next, before.enumMap, after.enumMap));
    }
    if (details.length) {
      changes.push({ after: next, before: old, details, kind: 'signature', stem });
    } else if ((old.description ?? '') !== (next.description ?? '')) {
      changes.push({ after: next, before: old, details: [], kind: 'description', stem });
    }
  }
  for (const [stem, next] of b) {
    if (!a.has(stem)) {
      changes.push({ after: next, before: null, details: [], kind: 'added', stem });
    }
  }
  const order = { added: 2, description: 3, removed: 0, signature: 1 };
  return changes.sort((x, y) => order[x.kind] - order[y.kind] || x.stem.localeCompare(y.stem));
}

export type EnumChange = { added: string[]; name: string; removed: string[] };

/** Enum tables whose symbols differ, including tables only one dictionary has. */
export function diffEnums(before: CommandDictionary, after: CommandDictionary): EnumChange[] {
  const names = [...new Set([...Object.keys(before.enumMap), ...Object.keys(after.enumMap)])].sort();
  return names
    .map(name => {
      const a = before.enumMap[name]?.values.map(v => v.symbol) ?? [];
      const b = after.enumMap[name]?.values.map(v => v.symbol) ?? [];
      return { added: b.filter(s => !a.includes(s)), name, removed: a.filter(s => !b.includes(s)) };
    })
    .filter(change => change.added.length || change.removed.length);
}
