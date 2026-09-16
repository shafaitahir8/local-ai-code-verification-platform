export {
  artifactSchema,
  changedFileSchema,
  findingSchema,
  gateResultSchema,
  gitReferenceSchema,
  lineStatisticsSchema,
  projectCapabilitySchema,
  projectEvidenceSchema,
  projectProfileAmbiguitySchema,
  projectProfileProgressSchema,
  projectProfileResultSchema,
  projectProfileSchema,
  projectProfileWarningSchema,
  projectScanStatisticsSchema,
  projectTaskCandidateSchema,
  projectWorkspaceUnitSchema,
  repositoryChangeSchema,
  verificationCheckResultSchema,
  verificationCheckSchema,
  verificationPlanCheckDecisionSchema,
  verificationPlanPreviewResultSchema,
  verificationPlanPreviewSchema,
  verificationPlanSchema,
  verificationRunSchema,
} from './domain-schemas.js';
export {
  decodeRequestLine,
  decodeResultLine,
  decodeServerMessageLine,
  encodeError,
  encodeEvent,
  encodeRequest,
  encodeResult,
  ProtocolDecodeError,
} from './codec.js';
export type { ProtocolDecodeErrorCode } from './codec.js';
export {
  jsonValueSchema,
  protocolErrorCodeSchema,
  protocolErrorSchema,
  protocolEventSchema,
  protocolRequestSchema,
  unknownProtocolResultSchema,
} from './messages.js';
export type {
  JsonPrimitive,
  JsonValue,
  ProtocolErrorCode,
  ProtocolErrorMessage,
  ProtocolEventMessage,
  ProtocolEventName,
  ProtocolRequest,
  ProtocolResultMessage,
  ProtocolServerMessage,
  UnknownProtocolResultMessage,
} from './messages.js';
export {
  projectConfigSchema,
  projectConfigV2Schema,
  projectPolicyResultSchema,
  projectConfigMigrationPreviewSchema,
  projectConfigMigrationApplySchema,
  projectDiscoveryResultSchema,
  PROTOCOL_VERSION,
  protocolParamsSchemas,
  protocolResultSchemas,
} from './methods.js';
export type {
  ProjectConfigMessage,
  ProjectConfigV2Message,
  ProjectDiscoveryResult,
  ProtocolMethod,
  ProtocolParamsMap,
  ProtocolResultMap,
  RepositoryInspectionResult,
} from './methods.js';
export { createRequestDecoder, createServerMessageDecoder, NdjsonDecoder } from './ndjson.js';
export type { NdjsonDecoderOptions } from './ndjson.js';
