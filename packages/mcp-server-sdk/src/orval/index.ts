/**
 * Orval Codegen Helpers
 *
 * Build-time helpers for Orval-generated API clients. Not used at runtime.
 */

export { orvalImportFixer } from "./orval-import-fixer.js";
export {
  relaxUntypedArrays,
  type OpenApiDocumentLike,
} from "./orval-relax-untyped-arrays.js";
export {
  createUmbracoTargetMajorTransformer,
  renderTargetMajorModule,
  DEFAULT_TARGET_MAJOR_CONSTANT,
  type OpenApiDocumentPassthrough,
  type UmbracoTargetMajorOptions,
  type TargetMajorSource,
} from "./orval-target-major-writer.js";
export {
  collectZodFiles,
  relaxUuidToGuid,
  camelCaseZodExports,
  restoreV7OptionalDefaults,
  postProcessZodFiles,
} from "./orval-zod-post-process.js";
