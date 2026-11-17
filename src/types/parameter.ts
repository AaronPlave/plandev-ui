import type { Availability } from '../utilities/availability';
import type { UIValueSchemaWithOptionsMultiple, UIValueSchemaWithOptionsSingle, ValueSchema } from './schema';

export type DefaultEffectiveArguments = {
  arguments: ArgumentsMap;
  typeName: string;
};

export type DefaultEffectiveArgumentsMap = Record<string, ArgumentsMap>;

export type ProcedureEffectiveArgumentsResponse = {
  arguments: ArgumentsMap;
  errors?: string[];
  id: number;
  revision: number;
};

export type SchedulingGoalEffectiveArguments = ProcedureEffectiveArgumentsResponse;
export type ConstraintEffectiveArguments = ProcedureEffectiveArgumentsResponse;

export type SchedulingGoalEffectiveArgumentsMap = Record<string, ArgumentsMap>;
export type ConstraintEffectiveArgumentsMap = Record<string, ArgumentsMap>;

export type EffectiveArguments = {
  arguments: ArgumentsMap;
  errors: ParametersErrorMap;
  success: boolean;
};

export type FormParameter<T = ValueSchema | UIValueSchemaWithOptionsSingle | UIValueSchemaWithOptionsMultiple> = {
  /** Value of the argument in the preset applied to the parent (if any), for comparison in the details view. */
  defaultValue?: Argument;
  errors: string[] | null;
  externalEvent?: boolean;
  file?: File;
  index?: number;
  key?: string;
  name: string;
  order: number;
  presetValue?: Argument;
  required?: boolean;
  schema: T;
  value: Argument;
  valueSource: ValueSource;
};

export type Argument = any;

export type ArgumentsMap = Record<ParameterName, Argument>;

export type Parameter = { order: number; schema: ValueSchema; unit?: string };
export type ComputedParameter = { order: number; schema: ValueSchema; units?: Record<ParameterName, string> };

export type ParameterError = { message: string; schema: ValueSchema };

export type ParametersErrorMap = Record<ParameterName, ParameterError>;

export type ParameterName = string;

export type RequiredParametersList = ParameterName[];

export type ParametersMap = Record<ParameterName, Parameter>;
export type ComputedParametersMap = Record<ParameterName, ComputedParameter>;

export type ParameterValidationError = {
  message: string;
  subjects: string[];
};

export type ParameterValidationResponse = {
  errors?: ParameterValidationError[];
  success: boolean;
};

/**
 * What the user can do in a `Parameters` tree. Kept deliberately small: read-only parameters are a different
 * *presentation* (not disabled editors), and expand/collapse, inspect (details) and native text selection are always
 * available regardless of these.
 */
export type ParameterCapabilities = {
  /** Edit values with the type-specific editors. When false, values are shown with the read-only presentation. */
  edit: boolean;
  /** Reset an overridden value to its preset/default. Unavailable carries the reason shown in the details view. */
  reset: Availability;
  /** Add/remove series items. */
  structure: Availability;
};

export type ParameterType = 'action' | 'activity' | 'constraint' | 'goal' | 'simulation';
export type ValueSource = 'user on model' | 'user on preset' | 'preset' | 'mission' | 'none';

export type ErrorMap = Record<string, string[]>;
