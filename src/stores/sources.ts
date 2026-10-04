import type { AnalysisSourceUsage, SourceLibraryEntry } from '../types/analysis';
import gql from '../utilities/gql';
import { gqlSubscribable } from './subscribable';

/** Every imported source with all its revisions, live: imports finish and fail while the page is open. */
export const sources = gqlSubscribable<SourceLibraryEntry[]>(gql.SUB_SOURCES, {}, []);

/** Every analysis's source bindings, to tell where a revision is used. */
export const analysisSourceUsage = gqlSubscribable<AnalysisSourceUsage[]>(gql.SUB_ANALYSIS_SOURCE_USAGE, {}, []);
